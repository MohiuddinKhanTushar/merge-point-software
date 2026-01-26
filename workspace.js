import { initSidebar } from './ui-manager.js';
import { db, auth } from './firebase-config.js';
import { doc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Initialize Sidebar
initSidebar();

const urlParams = new URLSearchParams(window.location.search);
const bidId = urlParams.get('id');
let activeSectionIndex = null;
let currentBidData = null;

onAuthStateChanged(auth, (user) => {
    if (user && bidId) {
        const docRef = doc(db, "bids", bidId);

        // ONE SINGLE LISTENER FOR EVERYTHING
        onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                currentBidData = data; // Store for global access
                
                // 1. Update Header & Info
                document.getElementById('bid-title').innerText = data.bidName || "Untitled Project";
                document.getElementById('bid-status').innerText = (data.status || "DRAFTING").toUpperCase();
                document.getElementById('client-name').innerHTML = `<strong>Client:</strong> ${data.client || "Not Specified"}`;
                
                if (data.deadline) {
                    document.getElementById('bid-deadline').innerHTML = `<strong>Due:</strong> ${data.deadline.toDate().toLocaleDateString()}`;
                }

                // 2. RENDER THE TRAFFIC LIGHT SECTIONS
                renderSectionsList(data.sections || []);

                // 3. Update Editor (if a section is active and user isn't typing)
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

// --- UI RENDERING FUNCTIONS ---

function renderSectionsList(sections) {
    const sectionsList = document.getElementById('sections-list');
    const genBtn = document.getElementById('generate-response-btn');

    if (sections.length === 0) {
        sectionsList.innerHTML = `<p class="empty-msg">Waiting for AI extraction...</p>`;
        if(genBtn) genBtn.style.display = 'none';
        return;
    }

    if(genBtn) genBtn.style.display = 'block';
    sectionsList.innerHTML = "";

    sections.forEach((section, index) => {
        const item = document.createElement('div');
        item.className = `section-item ${activeSectionIndex === index ? 'active' : ''}`;
        
        const statusClass = section.status === 'ready' ? 'status-ready' : 'status-attention';
        const statusLabel = section.status === 'ready' ? 'Ready' : 'Needs Attention';

        item.innerHTML = `
            <div class="section-info">
                <span class="badge ${statusClass}">${statusLabel}</span>
                <p class="section-q">${section.question.substring(0, 45)}${section.question.length > 45 ? '...' : ''}</p>
            </div>
        `;

        item.onclick = () => {
            activeSectionIndex = index;
            // Update UI immediately for snappiness
            document.querySelectorAll('.section-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            
            // Load content into editor
            const editor = document.getElementById('ai-content-editor');
            editor.value = section.aiResponse || "";
            editor.placeholder = `Editing response for: ${section.question}`;

            // Update Metrics
            document.getElementById('word-count').innerText = section.aiResponse ? section.aiResponse.split(/\s+/).length : 0;
            document.getElementById('confidence-level').innerText = section.confidence ? `${section.confidence}%` : "85%";
        };
        sectionsList.appendChild(item);
    });
}

// --- ACTION HANDLERS ---

// Save Button: Saves the current text to the specific active section
document.getElementById('save-bid-btn').addEventListener('click', async () => {
    if (activeSectionIndex === null) return alert("Select a section on the right to save changes.");
    
    const content = document.getElementById('ai-content-editor').value;
    const bidRef = doc(db, "bids", bidId);
    
    // Update only the specific section in the array
    const updatedSections = [...currentBidData.sections];
    updatedSections[activeSectionIndex].aiResponse = content;

    try {
        await updateDoc(bidRef, { sections: updatedSections });
        alert("Section saved!");
    } catch (e) {
        console.error("Save failed", e);
    }
});

// Mock AI Generation (The "Magic" button)
document.getElementById('generate-response-btn').addEventListener('click', async () => {
    const bidRef = doc(db, "bids", bidId);
    
    // Simulate finding questions in the document
    const mockSections = [
        { 
            question: "Provide an overview of your security infrastructure and data protection policies.", 
            status: "ready", 
            aiResponse: "Our security framework is based on ISO 27001 standards...", 
            confidence: 94 
        },
        { 
            question: "List three case studies of similar projects completed in the last 24 months.", 
            status: "attention", 
            aiResponse: "", 
            confidence: 40 
        },
        { 
            question: "Detail your disaster recovery and business continuity plan.", 
            status: "ready", 
            aiResponse: "We maintain 99.9% uptime through geographically redundant servers...", 
            confidence: 88 
        }
    ];

    try {
        await updateDoc(bidRef, { 
            sections: mockSections,
            status: "drafting" 
        });
        alert("AI has extracted the tender sections!");
    } catch (e) {
        console.error("Generation failed", e);
    }
});

// --- MODAL & SUBMISSION LOGIC (UNTOUCHED) ---

const modal = document.getElementById('review-modal');
document.getElementById('submit-review-btn').onclick = () => modal.style.display = 'block';
window.closeModal = () => modal.style.display = 'none';

document.getElementById('confirm-submit-btn').onclick = async () => {
    const email = document.getElementById('reviewer-email').value;
    if (!email) return alert("Please enter an email");

    const bidRef = doc(db, "bids", bidId);
    try {
        await updateDoc(bidRef, {
            status: "review",
            reviewerEmail: email,
            submittedAt: new Date()
        });
        alert(`Status updated to Review! Reviewer: ${email}`);
        closeModal();
    } catch (e) {
        console.error("Submission failed", e);
    }
};