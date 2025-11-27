// ===== In-browser blockchain with hashing, signatures, stats & export/import =====

let blockchain = [];

// --- SHA-256 using Web Crypto API [web:150][web:153] ---
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join('');
  return hashHex;
}

async function calculateHash(record) {
  const dataForHash = {
    propertyID: record.propertyID,
    owner: record.owner,
    description: record.description || '',
    remarks: record.remarks || '',
    action: record.action,
    timestamp: record.timestamp,
    previousHash: record.previousHash
  };
  return sha256(JSON.stringify(dataForHash));
}

function formatTime(isoString) {
  const date = new Date(isoString);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

// --- Simple "digital signature" [web:150][web:162] ---
async function signRecord(record, userSecret) {
  const toSign = `${record.propertyID}|${record.owner}|${record.action}|${record.timestamp}|${userSecret}`;
  return sha256(toSign);
}

// Add new block
async function addBlock(record, userSecret) {
  const lastBlock = blockchain[blockchain.length - 1];
  record.previousHash = lastBlock ? lastBlock.currentHash : "0";
  record.timestamp = new Date().toISOString();
  record.signature = await signRecord(record, userSecret);
  record.currentHash = await calculateHash(record);
  blockchain.push(record);
  renderLedger();
  updateStats();
}

// ----- Rendering -----

function renderLedger() {
  $('#propertyLedger').empty();
  blockchain.forEach((block, index) => {
    $('#propertyLedger').append(`
      <li class="ledger-item">
        <div><b>Block ${index + 1}</b></div>
        <div>PropertyID: <span class="highlight">${block.propertyID}</span></div>
        <div>Owner: <span class="highlight">${block.owner}</span></div>
        <div>Action: ${block.action}</div>
        <div>Description: ${block.description || 'N/A'}</div>
        <div>Remarks: ${block.remarks || 'N/A'}</div>
        <div>Prev Hash: <code>${block.previousHash}</code></div>
        <div>Hash: <code>${block.currentHash}</code></div>
        <div>Signature: <code>${block.signature}</code></div>
        <div class="timestamp">Time: ${formatTime(block.timestamp)}</div>
      </li>
    `);
  });
}

function showTimeline(propertyID) {
  $('#propertyTimeline').empty();
  const timelineBlocks = blockchain.filter(block => block.propertyID === propertyID);
  if (timelineBlocks.length === 0) {
    $('#propertyTimeline').append("<li>No actions found for this Property ID.</li>");
  } else {
    timelineBlocks.forEach((block, idx) => {
      $('#propertyTimeline').append(`
        <li class="timeline-item">
          <div><b>Step ${idx + 1}</b></div>
          <div>Action: ${block.action}</div>
          <div>Owner: <span class="highlight">${block.owner}</span></div>
          <div>Description: ${block.description || 'N/A'}</div>
          <div>Remarks: ${block.remarks || 'N/A'}</div>
          <div>Hash: <code>${block.currentHash}</code></div>
          <div class="timestamp">Time: ${formatTime(block.timestamp)}</div>
        </li>
      `);
    });
  }
}

// ----- Statistics (analytics) [web:134][web:137][web:139] -----

function updateStats() {
  const registered = new Set();
  let transfers = 0;
  const owners = new Set();

  blockchain.forEach(block => {
    owners.add(block.owner);
    if (block.action === "Register") {
      registered.add(block.propertyID);
    } else if (block.action === "Transfer") {
      transfers += 1;
    }
  });

  $('#statTotalProperties').text(registered.size);
  $('#statTotalTransfers').text(transfers);
  $('#statUniqueOwners').text(owners.size);
}

// ----- Chain + signature validation [web:151][web:156][web:159] -----

async function validateChain(globalSecret) {
  if (blockchain.length === 0) {
    return "Chain is empty (nothing to validate).";
  }

  for (let i = 0; i < blockchain.length; i++) {
    const current = blockchain[i];

    const recomputedHash = await calculateHash(current);
    if (recomputedHash !== current.currentHash) {
      return `Invalid: hash mismatch at block ${i + 1}.`;
    }

    if (i > 0) {
      const previous = blockchain[i - 1];
      if (current.previousHash !== previous.currentHash) {
        return `Invalid: broken link between block ${i} and ${i + 1}.`;
      }
    }

    const expectedSignature = await signRecord(current, globalSecret);
    if (expectedSignature !== current.signature) {
      return `Warning: signature invalid at block ${i + 1} (wrong secret or tampering).`;
    }
  }

  return "Chain is valid. All hashes and signatures match.";
}

// ----- Export / Import ledger as JSON [web:154][web:162] -----

function downloadLedger() {
  const dataStr = JSON.stringify(blockchain, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "property-ledger.json";
  a.click();
  URL.revokeObjectURL(url);
}

function loadLedgerFromFile(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed)) {
        alert("Invalid file format: expected an array.");
        return;
      }
      blockchain = parsed;
      renderLedger();
      updateStats();
      $('#validationResult').text("Ledger loaded from file. You can now validate the chain.");
    } catch (err) {
      alert("Error reading ledger file: " + err.message);
    }
  };
  reader.readAsText(file);
}

// ----- Event handlers -----

$(document).ready(function () {
  $('#registerProperty').click(async function () {
    const propertyID = $('#propertyID').val().trim();
    const description = $('#propertyDesc').val().trim();
    const owner = $('#ownerName').val().trim();
    const userSecret = $('#ownerSecret').val().trim();

    if (!userSecret) {
      alert("Please enter your Owner Secret (private key) first.");
      return;
    }

    const alreadyExists = blockchain.find(
      block => block.propertyID === propertyID && block.action === "Register"
    );

    if (alreadyExists) {
      alert("Property ID already registered!");
      return;
    }

    if (propertyID && owner) {
      await addBlock({ propertyID, description, owner, action: "Register" }, userSecret);
      alert("Property registered and signed successfully!");
      $('#propertyID').val('');
      $('#propertyDesc').val('');
      $('#ownerName').val('');
    } else {
      alert("Please enter Property ID and Owner Name.");
    }
  });

  $('#transferProperty').click(async function () {
    const propertyID = $('#transferPropertyID').val().trim();
    const newOwner = $('#newOwnerName').val().trim();
    const remarks = $('#transferRemarks').val().trim();
    const userSecret = $('#ownerSecret').val().trim();

    if (!userSecret) {
      alert("Please enter your Owner Secret (private key) first.");
      return;
    }

    if (propertyID && newOwner) {
      const found = blockchain.find(block => block.propertyID === propertyID);
      if (!found) {
        alert("Property ID not found! Register it first.");
        return;
      }
      await addBlock({ propertyID, owner: newOwner, action: "Transfer", remarks }, userSecret);
      alert("Property ownership transferred and signed!");
      $('#transferPropertyID').val('');
      $('#newOwnerName').val('');
      $('#transferRemarks').val('');
    } else {
      alert("Please enter Property ID and new Owner Name.");
    }
  });

  $('#showTimeline').click(function () {
    const propertyID = $('#timelinePropertyID').val().trim();
    if (!propertyID) {
      alert("Please enter a Property ID for timeline search.");
      return;
    }
    showTimeline(propertyID);
  });

  $('#validateChain').click(async function () {
    const userSecret = $('#ownerSecret').val().trim();
    if (!userSecret) {
      alert("Enter the Owner Secret you used to create the blocks, to verify signatures.");
      return;
    }
    const result = await validateChain(userSecret);
    $('#validationResult').text(result);
  });

  $('#downloadLedger').click(function () {
    if (blockchain.length === 0) {
      alert("Ledger is empty. Add some data first.");
      return;
    }
    downloadLedger();
  });

  $('#uploadLedger').change(function (event) {
    const file = event.target.files[0];
    if (file) {
      loadLedgerFromFile(file);
    }
  });

  renderLedger();
  updateStats();
});
