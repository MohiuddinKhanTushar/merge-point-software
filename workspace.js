import { initSidebar } from './ui-manager.js';
import { db, auth } from './firebase-config.js';
import { doc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// 1. ADD THESE IMPORTS
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Initialize Sidebar
initSidebar();

const urlParams = new URLSearchParams(window.location.search);
const bidId = urlParams.get('id');
const functions = getFunctions(); // Initialize Functions
let activeSectionIndex = null;
let currentBidData = null;

onAuthStateChanged(auth, (user) => {
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

                if (activeSectionIndex !== null && document.activeElement !== document.getElementById('ai-content-editor')) {
                    const activeSection = data.sections[activeSectionIndex];
                    document.getElementById('ai-content-editor').value = activeSection.aiResponse || "";
                }
            }
        });
    } else if (!user) {
        window.location.href = 'login.html';
    }
});

// --- UI RENDERING ---
function renderSectionsList(sections) {
    const sectionsList = document.getElementById('sections-list');
    const genBtn = document.getElementById('generate-response-btn');

    if (sections.length > 0) {
        genBtn.innerHTML = `<i data-lucide="refresh-cw"></i> Re-Analyze Document`;
        sectionsList.innerHTML = "";
        
        sections.forEach((section, index) => {
            const item = document.createElement('div');
            item.className = `section-item ${activeSectionIndex === index ? 'active' : ''}`;
            const statusClass = section.status === 'ready' ? 'status-ready' : 'status-attention';
            
            item.innerHTML = `
                <div class="section-info">
                    <span class="badge ${statusClass}">${section.status.toUpperCase()}</span>
                    <p class="section-q">${section.question.substring(0, 60)}...</p>
                </div>
            `;

            item.onclick = () => {
                activeSectionIndex = index;
                
                // 1. Update UI Selection
                document.querySelectorAll('.section-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                
                // 2. Fill the Grey Context Bar
                document.getElementById('current-section-name').innerText = section.question;
                
                // 3. Populate Editor & Stats
                const editor = document.getElementById('ai-content-editor');
                const content = section.aiResponse || "";
                editor.value = content;
                
                // Ensure placeholder is clear if we are editing
                editor.placeholder = "AI hasn't drafted this yet. Click 'Generate AI Draft' above to start.";
                
                updateMetrics(content, section.confidence);
                
                // 4. Update Icons (Lucide needs to re-run for dynamic content)
                if (window.lucide) lucide.createIcons();

                // TRIGGER THE DRAFTING LOGIC
                showDraftingInterface(section.question);
            };
            sectionsList.appendChild(item);
        });
    }
}

function updateMetrics(text, confidence) {
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    document.getElementById('word-count').innerText = wordCount;
    document.getElementById('confidence-level').innerText = confidence ? `${confidence}%` : "100%";
}

// --- ACTION HANDLERS ---

// REAL AI GENERATION (Calls Cloud Function)
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
            fileName: currentBidData.bidName
        });

        if (result.data.success) {
            alert(`Success! AI found ${result.data.count} sections.`);
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

// Save Logic
document.getElementById('save-bid-btn').addEventListener('click', async () => {
    if (activeSectionIndex === null) return alert("Select a section first.");
    const content = document.getElementById('ai-content-editor').value;
    const updatedSections = [...currentBidData.sections];
    updatedSections[activeSectionIndex].aiResponse = content;
    
    try {
        await updateDoc(doc(db, "bids", bidId), { sections: updatedSections });
        alert("Saved!");
    } catch (e) {
        alert("Error saving: " + e.message);
    }
});

function showDraftingInterface(questionText) {
    const magicBtn = document.getElementById('magic-draft-btn');
    
    // Reset the button state
    magicBtn.onclick = async () => {
        const editor = document.getElementById('ai-content-editor');
        const originalBtnText = magicBtn.innerHTML;
        
        // UI Loading State
        magicBtn.disabled = true;
        magicBtn.innerHTML = `<i class="spinner"></i> Drafting...`;
        editor.value = "AI is generating your draft...";

        try {
            // This calls your 'generateSectionDraft' Cloud Function
            const generateDraft = httpsCallable(functions, 'generateSectionDraft');
            const result = await generateDraft({ 
                question: questionText,
                bidId: bidId 
            });

            if (result.data.success) {
                editor.value = result.data.answer;
                // Update the local data so 'Save' works correctly
                currentBidData.sections[activeSectionIndex].aiResponse = result.data.answer;
                updateMetrics(result.data.answer, 95); // Assuming 95% confidence for now
            }
        } catch (e) {
            console.error("Drafting failed", e);
            editor.value = "Error generating draft. Please try again.";
        } finally {
            magicBtn.disabled = false;
            magicBtn.innerHTML = originalBtnText;
            if (window.lucide) lucide.createIcons();
        }
    };
}

const modal = document.getElementById('review-modal');
document.getElementById('submit-review-btn').onclick = () => modal.style.display = 'block';
window.closeModal = () => modal.style.display = 'none';