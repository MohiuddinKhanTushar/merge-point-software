import { initSidebar } from './ui-manager.js';
// FIXED: Added 'app' to the imports below
import { db, auth, app } from './firebase-config.js';
import { checkAuthState } from './auth.js'; 
import { doc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Initialize Sidebar
initSidebar();

const urlParams = new URLSearchParams(window.location.search);
const bidId = urlParams.get('id');

// This now works because 'app' is defined
const functions = getFunctions(app, "us-east1"); 

let activeSectionIndex = null;
let currentBidData = null;

// USE OUR GATEKEEPER
checkAuthState((user) => {
    if (user && bidId) {
        console.log("Workspace active for:", user.email);
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

                // If a section is active, update the editor and metrics from the live Firestore data
                if (activeSectionIndex !== null && document.activeElement !== document.getElementById('ai-content-editor')) {
                    const activeSection = data.sections[activeSectionIndex];
                    document.getElementById('ai-content-editor').value = activeSection.draftAnswer || activeSection.aiResponse || "";
                    updateMetrics(activeSection.draftAnswer || activeSection.aiResponse || "", activeSection.confidence);
                }
            }
        });
    }
});

// --- UI RENDERING ---

async function updateGlobalProgress(sections) {
    if (!sections || sections.length === 0) return;

    // 1. Calculate the percentage based on completed sections
    const completedCount = sections.filter(s => 
        (s.aiResponse && s.aiResponse.trim().length > 0) || 
        (s.draftAnswer && s.draftAnswer.trim().length > 0)
    ).length;
    
    const percentage = Math.round((completedCount / sections.length) * 100);

    // 2. Update the Local Workspace UI (The Progress Bar on the page)
    const bar = document.getElementById('overall-progress-bar');
    const text = document.getElementById('progress-text');
    if (bar && text) {
        bar.style.width = `${percentage}%`;
        text.innerText = `${percentage}% Done`;
        bar.style.background = percentage === 100 ? "#22c55e" : "#6366f1";
    }

    // 3. PERSIST TO FIRESTORE (This updates the Bid Card on the dashboard)
    try {
        const bidRef = doc(db, "bids", bidId);
        await updateDoc(bidRef, { 
            progress: percentage,
            // Logic: if they've started working, it's definitely 'drafting'
            status: percentage === 100 ? "review" : "drafting" 
        });
        console.log("Global progress synced to Firestore:", percentage);
    } catch (e) {
        console.error("Failed to sync progress to database:", e);
    }
}

function renderSectionsList(sections) {
    const sectionsList = document.getElementById('sections-list');
    const genBtn = document.getElementById('generate-response-btn');

    if (sections.length > 0) {
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
            } else if (section.status === 'attention') {
                statusText = "ATTENTION";
                statusClass = "status-attention";
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
                const content = section.draftAnswer || section.aiResponse || "";
                editor.value = content;
                editor.placeholder = "AI hasn't drafted this yet. Click 'Generate AI Draft' above to start.";
                
                // Pass the saved confidence from the section data
                updateMetrics(content, section.confidence);
                
                if (window.lucide) lucide.createIcons();
                setupMagicButton(section.question);
            };
            sectionsList.appendChild(item);
        });
    }
}

function setupMagicButton(questionText) {
    const magicBtn = document.getElementById('magic-draft-btn');
    const newBtn = magicBtn.cloneNode(true);
    magicBtn.parentNode.replaceChild(newBtn, magicBtn);

    newBtn.onclick = async () => {
        const editor = document.getElementById('ai-content-editor');
        const originalBtnHTML = newBtn.innerHTML;
        newBtn.disabled = true;
        newBtn.innerHTML = `<i data-lucide="sparkles" class="spin"></i> Drafting...`;
        if (window.lucide) lucide.createIcons();
        editor.value = "Gemini is drafting a professional response...";

        try {
            const generateDraft = httpsCallable(functions, 'generateSectionDraft');
            // UPDATED: Now passing bidId and sectionIndex for persistence
            const result = await generateDraft({ 
                question: questionText,
                bidId: bidId,
                sectionIndex: activeSectionIndex
            });

            if (result.data.success) {
                editor.value = result.data.answer;
                // Locally update state (onSnapshot will also handle this)
                currentBidData.sections[activeSectionIndex].draftAnswer = result.data.answer;
                currentBidData.sections[activeSectionIndex].confidence = result.data.confidence;
                
                updateMetrics(result.data.answer, result.data.confidence);
                updateGlobalProgress(currentBidData.sections);
            } else { throw new Error(result.data.error); }
        } catch (e) {
            console.error("Drafting failed", e);
            editor.value = "Error: " + e.message;
        } finally {
            newBtn.disabled = false;
            newBtn.innerHTML = originalBtnHTML;
            if (window.lucide) lucide.createIcons();
        }
    };
}

function updateMetrics(text, confidence) {
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    document.getElementById('word-count').innerText = wordCount;
    
    const confidenceEl = document.getElementById('confidence-level');
    // If confidence is 0 or undefined, show 10% as floor, otherwise show value
    const displayConfidence = confidence !== undefined ? confidence : 0;
    confidenceEl.innerText = displayConfidence > 0 ? `${displayConfidence}%` : "---";
}

// --- ACTION HANDLERS ---

document.getElementById('generate-response-btn').addEventListener('click', async () => {
    const btn = document.getElementById('generate-response-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="spinner"></i> Analyzing...`;

    try {
        const analyzeTender = httpsCallable(functions, 'analyzeTenderDocument');
        const result = await analyzeTender({ 
            bidId: bidId,
            documentUrl: currentBidData.pdfUrl || "", 
            fileName: currentBidData.fileName 
        });
        
        if (result.data.success) { 
            showToast(`Success! AI found ${result.data.count} sections.`); 
        } else { 
            alert("AI Analysis failed: " + result.data.error); 
        }
    } catch (e) {
        console.error("Call failed", e);
        alert("Error connecting to AI service.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
        if (window.lucide) lucide.createIcons();
    }
});

document.getElementById('save-bid-btn').addEventListener('click', async () => {
    if (activeSectionIndex === null) return alert("Select a section first.");
    const content = document.getElementById('ai-content-editor').value;
    const updatedSections = [...currentBidData.sections];
    
    // Save to the persistent field used by the AI
    updatedSections[activeSectionIndex].draftAnswer = content;
    
    try {
        await updateDoc(doc(db, "bids", bidId), { sections: updatedSections });
        updateGlobalProgress(updatedSections);
        showToast("Draft saved successfully!");
    } catch (e) { alert("Error saving: " + e.message); }
});

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
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

const modal = document.getElementById('review-modal');
if (document.getElementById('submit-review-btn')) {
    document.getElementById('submit-review-btn').onclick = () => modal.style.display = 'block';
}
window.closeModal = () => modal.style.display = 'none';