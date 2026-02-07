import { initSidebar } from './ui-manager.js';
import { db, auth, app } from './firebase-config.js';
import { checkAuthState } from './auth.js'; 
import { doc, onSnapshot, updateDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Initialize Sidebar
initSidebar();

const urlParams = new URLSearchParams(window.location.search);
const bidId = urlParams.get('id');
const functions = getFunctions(app, "us-east1"); 

let activeSectionIndex = null;
let currentBidData = null;

// --- AUTH & DATA SYNC ---
checkAuthState((user) => {
    if (user && bidId) {
        const docRef = doc(db, "bids", bidId);
        onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                currentBidData = data;
                
                document.getElementById('bid-title').innerText = data.bidName || "Untitled Project";
                document.getElementById('bid-status').innerText = (data.status || "DRAFTING").toUpperCase();
                document.getElementById('client-name').innerHTML = `<strong>Client:</strong> ${data.client || "Not Specified"}`;
                
                if (data.deadline) {
                    document.getElementById('bid-deadline').innerHTML = `<strong>Due:</strong> ${data.deadline.toDate().toLocaleDateString()}`;
                }

                renderSectionsList(data.sections || []);
                updateGlobalProgress(data.sections || []);

                if (activeSectionIndex !== null && document.activeElement !== document.getElementById('ai-content-editor')) {
                    const activeSection = data.sections[activeSectionIndex];
                    document.getElementById('ai-content-editor').value = activeSection.draftAnswer || activeSection.aiResponse || "";
                    updateMetrics(activeSection.draftAnswer || activeSection.aiResponse || "", activeSection.confidence);
                }
            }
        });
        
        loadReviewerDropdown();
    }
});

// --- UI LOGIC ---

async function updateGlobalProgress(sections) {
    if (!sections || sections.length === 0) return;

    const completedCount = sections.filter(s => 
        (s.aiResponse && s.aiResponse.trim().length > 0) || 
        (s.draftAnswer && s.draftAnswer.trim().length > 0)
    ).length;
    
    const percentage = Math.round((completedCount / sections.length) * 100);

    const bar = document.getElementById('overall-progress-bar');
    const text = document.getElementById('progress-text');
    const submitBtn = document.getElementById('submit-review-btn');

    if (bar && text) {
        bar.style.width = `${percentage}%`;
        text.innerText = `${percentage}% Done`;
        bar.style.background = percentage === 100 ? "#22c55e" : "#6366f1";
    }

    if (submitBtn) {
        if (percentage < 100) {
            submitBtn.disabled = true;
            submitBtn.style.opacity = "0.5";
            submitBtn.style.cursor = "not-allowed";
        } else {
            submitBtn.disabled = false;
            submitBtn.style.opacity = "1";
            submitBtn.style.cursor = "pointer";
        }
    }

    try {
        const bidRef = doc(db, "bids", bidId);
        await updateDoc(bidRef, { 
            progress: percentage,
            status: (percentage === 100 && currentBidData.status === 'drafting') ? "drafting" : currentBidData.status 
        });
    } catch (e) { console.error("Sync error:", e); }
}

async function loadReviewerDropdown() {
    const existingDropdown = document.getElementById('reviewer-select');
    if (existingDropdown) return;

    const select = document.createElement('select');
    select.id = 'reviewer-select';
    select.className = "reviewer-dropdown-style"; // Ensure this class exists in your CSS or style it manually
    select.style.cssText = "width:100%; padding:12px; margin-bottom:15px; border-radius:8px; border:1px solid #ddd;";

    const defaultOpt = document.createElement('option');
    defaultOpt.text = "Select a Manager/Reviewer...";
    select.add(defaultOpt);

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        querySnapshot.forEach((doc) => {
            const userData = doc.data();
            const opt = document.createElement('option');
            opt.value = userData.email;
            opt.text = `${userData.displayName || 'Team Member'} (${userData.email})`;
            select.add(opt);
        });
        
        const oldInput = document.getElementById('reviewer-email');
        if (oldInput) oldInput.replaceWith(select);
    } catch (e) {
        console.error("Error loading directory:", e);
    }
}

// --- SUBMISSION HANDLER ---

document.getElementById('confirm-submit-btn').onclick = async () => {
    const reviewerEmail = document.getElementById('reviewer-select').value;
    const btn = document.getElementById('confirm-submit-btn');

    if (!reviewerEmail || reviewerEmail.includes("Select")) {
        return alert("Please select a reviewer from the directory.");
    }

    btn.disabled = true;
    btn.innerText = "Sending...";

    try {
        const bidRef = doc(db, "bids", bidId);
        await updateDoc(bidRef, {
            status: "review",
            assignedReviewer: reviewerEmail,
            submittedAt: new Date()
        });

        showToast("Tender submitted successfully!");
        setTimeout(() => window.location.href = 'index.html', 1500);
    } catch (e) {
        alert("Submission failed: " + e.message);
        btn.disabled = false;
        btn.innerText = "Send to Reviewer";
    }
};

// --- CORE UTILITIES ---

function renderSectionsList(sections) {
    const sectionsList = document.getElementById('sections-list');
    const genBtn = document.getElementById('generate-response-btn');
    if (!sectionsList) return;

    genBtn.innerHTML = `<i data-lucide="refresh-cw"></i> Re-Analyze Document`;
    sectionsList.innerHTML = "";

    sections.forEach((section, index) => {
        const item = document.createElement('div');
        item.className = `section-item ${activeSectionIndex === index ? 'active' : ''}`;
        
        let statusText = "EMPTY";
        let statusClass = "status-empty";

        if ((section.aiResponse && section.aiResponse.trim().length > 0) || (section.draftAnswer && section.draftAnswer.trim().length > 0)) {
            statusText = "COMPLETED";
            statusClass = "status-ready";
        }

        item.innerHTML = `
            <div class="section-info">
                <span class="badge ${statusClass}">${statusText}</span>
                <p class="section-q">${section.question.substring(0, 60)}...</p>
            </div>
        `;

        item.onclick = () => {
            activeSectionIndex = index;
            document.querySelectorAll('.section-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            document.getElementById('current-section-name').innerText = section.question;
            const editor = document.getElementById('ai-content-editor');
            editor.value = section.draftAnswer || section.aiResponse || "";
            updateMetrics(editor.value, section.confidence);
            setupMagicButton(section.question);
        };
        sectionsList.appendChild(item);
    });
    if (window.lucide) lucide.createIcons();
}

function updateMetrics(text, confidence) {
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    const wordCountEl = document.getElementById('word-count');
    const confidenceEl = document.getElementById('confidence-level');
    
    if (wordCountEl) wordCountEl.innerText = wordCount;
    if (confidenceEl) confidenceEl.innerText = confidence ? `${confidence}%` : "---";
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return console.log("Toast:", message);
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'check-circle' : 'alert-circle';
    toast.innerHTML = `<i data-lucide="${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    
    if (window.lucide) lucide.createIcons();
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

function setupMagicButton(questionText) {
    const magicBtn = document.getElementById('magic-draft-btn');
    if (!magicBtn) return;
    const newBtn = magicBtn.cloneNode(true);
    magicBtn.parentNode.replaceChild(newBtn, magicBtn);

    newBtn.onclick = async () => {
        const editor = document.getElementById('ai-content-editor');
        newBtn.disabled = true;
        newBtn.innerHTML = `<i data-lucide="sparkles" class="spin"></i> Drafting...`;
        if (window.lucide) lucide.createIcons();

        try {
            const generateDraft = httpsCallable(functions, 'generateSectionDraft');
            const result = await generateDraft({ 
                question: questionText, 
                bidId: bidId, 
                sectionIndex: activeSectionIndex 
            });

            if (result.data.success) {
                editor.value = result.data.answer;
                showToast("Draft generated!");
            }
        } catch (e) {
            showToast("Drafting failed", "error");
        } finally {
            newBtn.disabled = false;
            newBtn.innerHTML = `<i data-lucide="sparkles"></i> Magic AI Draft`;
            if (window.lucide) lucide.createIcons();
        }
    };
}

// Modal Toggle
const modal = document.getElementById('review-modal');
const openModalBtn = document.getElementById('submit-review-btn');
if (openModalBtn) {
    openModalBtn.onclick = () => modal.style.display = 'flex';
}
window.closeModal = () => modal.style.display = 'none';