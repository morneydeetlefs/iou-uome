// app.js
let db;
let currentIOUs = [];
let currentType = 'item';
let currentFilter = 'all';
let currentEditingId = null;

const DB_NAME = "LendTrackDB";
const STORE_NAME = "ious";

// Initialize IndexedDB
function initDB() {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: "id" });
    }
  };
  request.onsuccess = (e) => {
    db = e.target.result;
    loadIOUs();
  };
  request.onerror = () => console.error("IndexedDB error");
}

// ====================== NEW: Upload photo to ImgBB ======================
async function uploadPhotoToImgBB(base64Data) {
  try {
    // Remove data:image/...;base64, prefix
    const base64String = base64Data.split(',')[1];

    const formData = new FormData();
    formData.append('image', base64String);

    // Using public demo endpoint (works without API key, but limited)
    const response = await fetch('https://api.imgbb.com/1/upload?expiration=7776000', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (result.success && result.data?.url) {
      return result.data.url;        // Public URL
    } else {
      console.warn("ImgBB upload failed:", result);
      return null;
    }
  } catch (error) {
    console.warn("ImgBB upload error:", error);
    return null;   // Will fallback to base64
  }
}
// Load all IOUs
function loadIOUs() {
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const req = store.getAll();
  req.onsuccess = () => {
    currentIOUs = req.result || [];
    renderHome();
  };
}

// Save IOU
function saveIOU(iou) {
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.put(iou);
  tx.oncomplete = () => loadIOUs();
}

// Create new IOU
// ====================== UPDATED: createIOU() ======================
async function createIOU() {
  const description = document.getElementById("description").value.trim();
  const otherParty = document.getElementById("other-party").value.trim();
  const dueDateStr = document.getElementById("due-date").value;
  const notes = document.getElementById("notes").value.trim();

  if (!description || !otherParty || !dueDateStr) {
    alert("Please fill in Description, Other Party, and Due Date");
    return;
  }

  const dueDate = new Date(dueDateStr);

  let photoUrl = null;
  const fileInput = document.getElementById("photo-input");

  // Handle photo upload
  if (fileInput.files && fileInput.files[0]) {
    const reader = new FileReader();
    reader.onload = async function(e) {
      const base64 = e.target.result;

      // Try to upload to ImgBB first
      photoUrl = await uploadPhotoToImgBB(base64);

      // Create IOU with photo (URL preferred, base64 as fallback)
      const iou = {
        id: "iou_" + Date.now(),
        type: currentType,
        description: description,
        otherParty: otherParty,
        dueDate: dueDate.toISOString(),
        notes: notes,
        createdAt: new Date().toISOString(),
        status: "active",
        lenderSigned: true,
        borrowerSigned: false,
        photoUrl: photoUrl,           // Preferred
        photoBase64: photoUrl ? null : base64   // Only store base64 if upload failed
      };

      // Clean money handling to avoid floating point errors
if (currentType === "money") {
  let rawAmount = parseFloat(document.getElementById("amount").value) || 0;
  let rawInterest = parseFloat(document.getElementById("interest").value) || 0;

  // Round to 2 decimal places safely
  iou.amount = Math.round(rawAmount * 100) / 100;
  iou.interest = Math.round(rawInterest * 100) / 100;
}

      saveIOU(iou);
      showQRModal(iou);
    };
    reader.readAsDataURL(fileInput.files[0]);
  }
  else {
    // No photo selected
    const iou = {
      id: "iou_" + Date.now(),
      type: currentType,
      description: description,
      otherParty: otherParty,
      dueDate: dueDate.toISOString(),
      notes: notes,
      createdAt: new Date().toISOString(),
      status: "active",
      lenderSigned: true,
      borrowerSigned: false,
      photoUrl: null,
      photoBase64: null
    };

    if (currentType === "money") {
      iou.amount = parseFloat(document.getElementById("amount").value) || 0;
      iou.interest = parseFloat(document.getElementById("interest").value) || 0;
    }

    saveIOU(iou);
    showQRModal(iou);
  }
}

function setType(type) {
  currentType = type;
  document.getElementById("type-item").classList.toggle("bg-emerald-600", type === "item");
  document.getElementById("type-item").classList.toggle("bg-zinc-700", type !== "item");
  document.getElementById("type-money").classList.toggle("bg-emerald-600", type === "money");
  document.getElementById("type-money").classList.toggle("bg-zinc-700", type !== "money");

  document.getElementById("item-fields").classList.toggle("hidden", type === "money");
  document.getElementById("money-fields").classList.toggle("hidden", type === "item");
}

// Render Home
function renderHome() {
  const now = new Date();

  // Overdue / Due soon
  const urgent = currentIOUs
    .filter(iou => iou.status === "active")
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  const overdueHTML = urgent.slice(0, 5).map(iou => {
    const due = new Date(iou.dueDate);
    const isOverdue = due < now;
    return `
      <div onclick="showDetail('${iou.id}')" class="bg-zinc-900 p-4 rounded-2xl flex gap-4 ${isOverdue ? 'overdue border border-red-500' : ''}">
        <div class="flex-1">
          <p class="font-medium">${iou.description}</p>
          <p class="text-sm text-zinc-400">${iou.otherParty}</p>
          <p class="text-xs ${isOverdue ? 'text-red-400' : 'text-amber-400'}">
            ${isOverdue ? 'Overdue' : 'Due'} ${due.toLocaleDateString('en-ZA')}
          </p>
        </div>
      </div>`;
  }).join("");

  document.getElementById("overdue-list").innerHTML = overdueHTML || "<p class='text-zinc-500 text-center py-8'>No urgent IOUs</p>";

  // Counts
  const lentCount = currentIOUs.filter(i => i.status === "active").length;
  document.getElementById("lent-count").textContent = lentCount;

  renderAllList();
}

function renderAllList() {
  let filtered = currentIOUs;
  if (currentFilter !== "all") {
    // Simplified - you can expand later
  }

  const html = filtered.map(iou => {
    const due = new Date(iou.dueDate);
    const isOverdue = due < new Date() && iou.status === "active";
    return `
      <div onclick="showDetail('${iou.id}')" class="bg-zinc-900 p-4 rounded-2xl flex justify-between items-center">
        <div>
          <p class="font-medium">${iou.description}</p>
          <p class="text-sm text-zinc-400">${iou.otherParty}</p>
        </div>
        <div class="text-right">
          <p class="${isOverdue ? 'text-red-400' : 'text-emerald-400'} text-sm">
            ${due.toLocaleDateString('en-ZA')}
          </p>
          <span class="text-xs px-2 py-0.5 rounded-full ${iou.status === 'returned' ? 'bg-green-900 text-green-300' : 'bg-amber-900 text-amber-300'}">
            ${iou.status}
          </span>
        </div>
      </div>`;
  }).join("");

  document.getElementById("all-list").innerHTML = html || "<p class='text-zinc-500 py-8 text-center'>No IOUs yet</p>";
}

function showTab(n) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active", "bg-zinc-800"));
  document.getElementById("tab" + n).classList.add("active", "bg-zinc-800");

  document.getElementById("screen-home").classList.toggle("hidden", n !== 0);
  document.getElementById("screen-new").classList.toggle("hidden", n !== 1);

  if (n === 1) {
    document.getElementById("due-date").value = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];
  }
}

// Show detail modal
function showDetail(id) {
  const iou = currentIOUs.find(i => i.id === id);
  if (!iou) return;

  currentEditingId = id;

  let content = `
    <div class="flex flex-col gap-3">
  <button onclick="shareViaWhatsApp()"
          class="w-full py-4 bg-green-600 hover:bg-green-700 rounded-2xl font-medium">
    Share via WhatsApp
  </button>

  <button onclick="copyShareableText()"
          class="w-full py-4 bg-zinc-700 hover:bg-zinc-600 rounded-2xl font-medium">
    Copy Shareable Text
  </button>

  <button onclick="showQRModal(currentIOUs.find(i=>i.id===currentEditingId))"
          class="w-full py-4 bg-blue-600 hover:bg-blue-700 rounded-2xl font-medium">
    Show QR Code (for other person to scan)
  </button>
</div>
  `;

  document.getElementById("modal-content").innerHTML = content;
  document.getElementById("modal-title").textContent = iou.type.toUpperCase() + " IOU";
  document.getElementById("modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}

function markReturned() {
  if (!currentEditingId) return;
  const iou = currentIOUs.find(i => i.id === currentEditingId);
  if (iou) {
    iou.status = "returned";
    saveIOU(iou);
    closeModal();
  }
}

// QR Code Modal
function showQRModal(iou) {
  closeModal();
  const qrHTML = `
    <div class="text-center">
      <p class="mb-4">Scan this QR with LendTrack to accept</p>
      <div id="qrcode-container" class="mx-auto bg-white p-4 inline-block rounded-2xl"></div>
      <p class="text-xs text-zinc-500 mt-6">Both parties should have the app for best proof</p>
    </div>
  `;
  document.getElementById("modal-content").innerHTML = qrHTML;
  document.getElementById("modal-title").textContent = "Share IOU";
  document.getElementById("modal").classList.remove("hidden");

  setTimeout(() => {
    new QRCode(document.getElementById("qrcode-container"), {
      text: JSON.stringify({
        id: iou.id,
        description: iou.description,
        otherParty: iou.otherParty,
        dueDate: iou.dueDate,
        type: iou.type
      }),
      width: 220,
      height: 220,
      colorDark: "#000000",
      colorLight: "#ffffff"
    });
  }, 100);
}

// Share via WhatsApp (text + gentle reminder)
function shareViaWhatsApp() {
  const iou = currentIOUs.find(i => i.id === currentEditingId);
  if (!iou) return;

  const due = new Date(iou.dueDate).toLocaleDateString('en-ZA');
  let text = `Hey ${iou.otherParty},\n\n`;
  text += `This is a friendly reminder of our IOU:\n`;
  text += `${iou.description}\n`;
  if (iou.type === 'money') text += `Amount: R${Number(iou.amount).toFixed(2)}\n`;
  text += `Due: ${due}\n\n`;
  text += `Please return it soon 🙂\n`;
  text += `Recorded with LendTrack`;

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(whatsappUrl, '_blank');
}

// Tab active style
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.classList.add('active', 'bg-zinc-800');
});

// ====================== IMPROVED SHARING - Option C ======================

function generateShareableText(iou) {
  const dueDate = new Date(iou.dueDate).toLocaleDateString('en-ZA');
  let text = `Hey ${iou.otherParty},\n\n`;

  text += `This is our agreement recorded on Uome:\n\n`;

  if (iou.type === 'money') {
    text += `Amount: R${Number(iou.amount).toFixed(2)}\n`;
  }

  text += `Item/Description: ${iou.description}\n`;
  text += `Due Date: ${dueDate}\n\n`;

  if (iou.notes) {
    text += `Notes: ${iou.notes}\n\n`;
  }

  text += `Please reply with: *I accept*  so we both have confirmation.\n\n`;
  text += `Recorded on ${new Date(iou.createdAt).toLocaleDateString('en-ZA')} via Uome\n`;
  text += `Thanks!`;

  return text;
}

function shareViaWhatsApp() {
  const iou = currentIOUs.find(i => i.id === currentEditingId);
  if (!iou) return;

  const message = generateShareableText(iou);

  // Open WhatsApp with pre-filled message
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, '_blank');
}

function copyShareableText() {
  const iou = currentIOUs.find(i => i.id === currentEditingId);
  if (!iou) return;

  const message = generateShareableText(iou);

  navigator.clipboard.writeText(message).then(() => {
    alert("Shareable text copied to clipboard!\n\nPaste it in WhatsApp or send to the other person.");
  }).catch(() => {
    alert("Failed to copy. Please try again.");
  });
}

// Start the app
initDB();
showTab(0);
