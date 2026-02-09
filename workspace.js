import { initSidebar } from './ui-manager.js';
import { db, auth, app } from './firebase-config.js';
import { checkAuthState } from './auth.js'; 
import { doc, onSnapshot, updateDoc, collection, getDocs, addDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

initSidebar();

const urlParams = new URLSearchParams(window.location.search);
const bidId = urlParams.get('id');
const functions = getFunctions(app, "us-east1"); 

let activeSectionIndex = null;
let currentBidData = null;

checkAuthState((user) => {
    if (user && bidId) {
        const docRef = doc(db, "bids", bidId);
        onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                currentBidData = data;
                
                const titleEl = document.getElementById('bid-title');
                if (titleEl) titleEl.innerText = data.bidName || "Untitled Project";
                
                const statusEl = document.getElementById('bid-status');
                if (statusEl) statusEl.innerText = (data.status || "DRAFTING").toUpperCase();
                
                const clientEl = document.getElementById('client-name');
                if (clientEl) clientEl.innerHTML = `<strong>Client:</strong> ${data.client || "Not Specified"}`;
                
                const deadlineEl = document.getElementById('bid-deadline');
                if (deadlineEl && data.deadline) {
                    deadlineEl.innerHTML = `<strong>Due:</strong> ${data.deadline.toDate().toLocaleDateString()}`;
                }

                renderSectionsList(data.sections || []);
                updateGlobalProgress(data.sections || []);

                const editor = document.getElementById('ai-content-editor');
                if (activeSectionIndex !== null && editor && document.activeElement !== editor) {
                    const activeSection = data.sections[activeSectionIndex];
                    editor.value = activeSection.draftAnswer || activeSection.aiResponse || "";
                    updateMetrics(editor.value, activeSection.confidence);
                    displayManagerFeedback(activeSection);
                }

                const downloadBtn = document.getElementById('download-pdf-btn');
                if (downloadBtn) {
                    const isDone = (data.progress === 100);
                    downloadBtn.style.display = isDone ? 'inline-flex' : 'none';
                    downloadBtn.onclick = generateBrandedPDF;
                }
            }
        });
        loadReviewerDropdown();
        const saveBtn = document.getElementById('save-bid-btn');
        if (saveBtn) saveBtn.onclick = saveActiveSection;
    }
});

async function generateBrandedPDF() {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) return showToast("jsPDF library not initialized. Please refresh.", "error");

    // Initialize with compress: true to keep file size optimized despite high-res assets
    const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
        compress: true
    });

    const downloadBtn = document.getElementById('download-pdf-btn');
    if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Rendering Ultra-HD...`;
    }
    if (window.lucide) lucide.createIcons();

    const loadAssetAsImage = async (url) => {
        let pdfLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
        if (!pdfLib) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js";
                script.onload = () => { pdfLib = window.pdfjsLib; resolve(); };
                script.onerror = () => reject(new Error("Failed to load PDF engine."));
                document.head.appendChild(script);
            });
        }

        try {
            if (url.toLowerCase().includes('.pdf')) {
                pdfLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
                const loadingTask = pdfLib.getDocument({ url: url, cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/cmaps/', cMapPacked: true });
                const pdf = await loadingTask.promise;
                const page = await pdf.getPage(1);
                
                // --- ULTRA-HIGH RESOLUTION (300+ DPI) ---
                const viewport = page.getViewport({ scale: 5.0 }); 
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                
                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = 'high';

                await page.render({ canvasContext: context, viewport: viewport }).promise;
                // Using PNG to maintain absolute sharpness for logos
                return canvas.toDataURL('image/png'); 
            } else {
                return new Promise((res, rej) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous"; 
                    img.src = url + (url.includes('?') ? '&' : '?') + "t=" + new Date().getTime();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width; canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(img, 0, 0);
                        res(canvas.toDataURL('image/png'));
                    };
                    img.onerror = () => rej(new Error("Image failed to load"));
                });
            }
        } catch (err) { throw err; }
    };

    try {
        // 1. Fetch Branding Assets
        const qAssets = query(collection(db, "knowledge"), where("ownerId", "==", auth.currentUser.uid));
        const snapAssets = await getDocs(qAssets);
        const assets = snapAssets.docs.map(d => d.data());
        
        // 2. Fetch Actual User Name from Firestore (Fix for "Proposal Lead" issue)
        const qUser = query(collection(db, "users"), where("uid", "==", auth.currentUser.uid));
        const snapUser = await getDocs(qUser);
        let actualName = "Proposal Lead";
        if (!snapUser.empty) {
            actualName = snapUser.docs[0].data().displayName || auth.currentUser.displayName || "Proposal Lead";
        }

        const titlePageAsset = assets.find(a => a.category === 'title-page');
        const contactPageAsset = assets.find(a => a.category === 'contact-page');

        // --- RENDER TITLE PAGE ---
        if (titlePageAsset?.fileUrl) {
            try {
                const imgData = await loadAssetAsImage(titlePageAsset.fileUrl);
                // Use 'NONE' alias to prevent jsPDF from downscaling our high-res assets
                doc.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'NONE');
                
                if (titlePageAsset.mapping) {
                    const map = titlePageAsset.mapping;
                    const style = titlePageAsset.fontStyle || { family: 'helvetica', size: 24 };
                    doc.setTextColor(40, 40, 40);
                    
                    if (map.tenderName) {
                        doc.setFont(style.family, "bold");
                        doc.setFontSize(style.size);
                        doc.text(currentBidData.bidName || "Project Proposal", map.tenderName.x * 210, map.tenderName.y * 297);
                    }
                    if (map.clientName) {
                        doc.setFont(style.family, "normal");
                        doc.setFontSize(Math.max(12, Math.round(style.size * 0.6)));
                        doc.text(currentBidData.client || "Valued Client", map.clientName.x * 210, map.clientName.y * 297);
                    }
                    if (map.userName) {
                        doc.setFont(style.family, "normal");
                        doc.setFontSize(Math.max(12, Math.round(style.size * 0.5)));
                        // Correctly inserting only the Name
                        doc.text(actualName, map.userName.x * 210, map.userName.y * 297);
                    }
                    if (map.date) {
                        doc.setFont(style.family, "normal");
                        doc.setFontSize(Math.max(10, Math.round(style.size * 0.4)));
                        const dateStr = new Date().toLocaleDateString('en-GB');
                        doc.text(dateStr, map.date.x * 210, map.date.y * 297);
                    }
                }
                doc.addPage();
            } catch (e) { console.warn("Title page skip", e); }
        }

        // --- RENDER CONTENT SECTIONS ---
        doc.setTextColor(0, 0, 0);
        let y = 30;
        currentBidData.sections.forEach((section, i) => {
            if (y > 260) { doc.addPage(); y = 30; }
            doc.setFont("helvetica", "bold"); doc.setFontSize(16);
            const titleLines = doc.splitTextToSize(`${i + 1}. ${section.sectionTitle || 'Section'}`, 170);
            doc.text(titleLines, 20, y);
            y += (titleLines.length * 8);
            
            doc.setFont("helvetica", "normal"); doc.setFontSize(11);
            const content = section.draftAnswer || section.aiResponse || "No content provided.";
            const bodyLines = doc.splitTextToSize(content, 170);
            doc.text(bodyLines, 20, y);
            y += (bodyLines.length * 7) + 15;
        });

        // --- RENDER CONTACT PAGE ---
        if (contactPageAsset?.fileUrl) {
            try {
                doc.addPage();
                const contactImgData = await loadAssetAsImage(contactPageAsset.fileUrl);
                doc.addImage(contactImgData, 'PNG', 0, 0, 210, 297, undefined, 'NONE');
            } catch (e) { console.warn("Contact page skip", e); }
        }

        doc.save(`${currentBidData.bidName || 'Bid'}_Final.pdf`);
        showToast("Final PDF Downloaded!");

    } catch (e) {
        console.error("PDF Error:", e);
        showToast("Error generating PDF: " + e.message, "error");
    } finally {
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = `<i data-lucide="file-down"></i> Export PDF`;
        }
        if (window.lucide) lucide.createIcons();
    }
}

function displayManagerFeedback(section) {
    const container = document.getElementById('manager-feedback-box');
    if (!container) return;
    if (section.status === 'flagged' && section.managerNotes) {
        container.innerHTML = `
            <div id="active-feedback-card" style="background: #fff1f2; border: 1px solid #fda4af; border-left: 5px solid #ef4444; padding: 15px; margin-bottom: 20px; border-radius: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; color: #9f1239; font-weight: 800; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
                    <i data-lucide="message-square" style="width:16px; height:16px;"></i> Manager Revision Notes
                </div>
                <p style="color: #be123c; margin: 0; font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap;">${section.managerNotes}</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    } else { container.innerHTML = ""; }
}

function renderSectionsList(sections) {
    const sectionsList = document.getElementById('sections-list');
    if (!sectionsList) return;
    sectionsList.innerHTML = "";
    sections.forEach((section, index) => {
        const item = document.createElement('div');
        item.className = `section-item ${activeSectionIndex === index ? 'active' : ''}`;
        let statusText = "EMPTY", statusClass = "status-empty";
        if (section.status === 'flagged') { statusText = "ACTION REQ."; statusClass = "status-flagged"; }
        else if ((section.aiResponse?.trim()) || (section.draftAnswer?.trim())) { statusText = "COMPLETED"; statusClass = "status-ready"; }
        
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
            const nameEl = document.getElementById('current-section-name');
            if (nameEl) nameEl.innerText = section.question;
            const editor = document.getElementById('ai-content-editor');
            if (editor) {
                editor.value = section.draftAnswer || section.aiResponse || "";
                updateMetrics(editor.value, section.confidence);
            }
            displayManagerFeedback(section);
            setupMagicButton(section.question);
        };
        sectionsList.appendChild(item);
    });
}

async function saveActiveSection() {
    if (activeSectionIndex === null || !currentBidData) return showToast("Select a section first", "error");
    const saveBtn = document.getElementById('save-bid-btn');
    const originalContent = saveBtn?.innerHTML;
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Saving...`;
    }
    const editorValue = document.getElementById('ai-content-editor')?.value || "";
    const updatedSections = [...currentBidData.sections];
    updatedSections[activeSectionIndex].draftAnswer = editorValue;
    updatedSections[activeSectionIndex].status = 'completed';
    updatedSections[activeSectionIndex].managerNotes = ""; 
    try {
        await updateDoc(doc(db, "bids", bidId), { sections: updatedSections });
        showToast("Changes saved.");
    } catch (e) { showToast("Error saving", "error"); }
    finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalContent;
        }
        if (window.lucide) lucide.createIcons();
    }
}

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveActiveSection(); }
});

async function updateGlobalProgress(sections) {
    if (!sections || sections.length === 0) return;
    const completedCount = sections.filter(s => (s.aiResponse?.trim()) || (s.draftAnswer?.trim())).length;
    const percentage = Math.round((completedCount / sections.length) * 100);
    const bar = document.getElementById('overall-progress-bar');
    const text = document.getElementById('progress-text');
    const submitBtn = document.getElementById('submit-review-btn');
    if (bar) bar.style.width = `${percentage}%`;
    if (text) text.innerText = `${percentage}% Done`;
    if (submitBtn) { submitBtn.disabled = percentage < 100; submitBtn.style.opacity = percentage < 100 ? "0.5" : "1"; }
    try { await updateDoc(doc(db, "bids", bidId), { progress: percentage }); } catch (e) {}
}

async function loadReviewerDropdown() {
    const existingDropdown = document.getElementById('reviewer-select');
    const oldInput = document.getElementById('reviewer-email');
    if (existingDropdown || !oldInput) return;
    const select = document.createElement('select');
    select.id = 'reviewer-select';
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
        oldInput.replaceWith(select);
    } catch (e) {}
}

const confirmSubmitBtn = document.getElementById('confirm-submit-btn');
if (confirmSubmitBtn) {
    confirmSubmitBtn.onclick = async () => {
        const reviewerEmail = document.getElementById('reviewer-select')?.value;
        if (!reviewerEmail || reviewerEmail.includes("Select")) return alert("Please select a reviewer.");
        confirmSubmitBtn.disabled = true;
        try {
            await updateDoc(doc(db, "bids", bidId), { status: "review", assignedReviewer: reviewerEmail, submittedAt: new Date() });
            await addDoc(collection(db, "notifications"), { recipientEmail: reviewerEmail, type: "submission", message: `New tender: ${currentBidData.bidName}`, bidId: bidId, read: false, createdAt: new Date() });
            showToast("Submitted!");
            setTimeout(() => window.location.href = 'index.html', 1500);
        } catch (e) { alert("Failed: " + e.message); confirmSubmitBtn.disabled = false; }
    };
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
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}"></i><span>${message}</span>`;
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 500); }, 3000);
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
            const result = await generateDraft({ question: questionText, bidId: bidId, sectionIndex: activeSectionIndex });
            if (result.data.success && editor) { editor.value = result.data.answer; showToast("Draft generated!"); }
        } catch (e) { showToast("Drafting failed", "error"); } finally {
            newBtn.disabled = false;
            newBtn.innerHTML = `<i data-lucide="wand-2"></i> Generate AI Draft`;
            if (window.lucide) lucide.createIcons();
        }
    };
}

const modal = document.getElementById('review-modal');
const openModalBtn = document.getElementById('submit-review-btn');
if (openModalBtn && modal) openModalBtn.onclick = () => modal.style.display = 'flex';
window.closeModal = () => { if (modal) modal.style.display = 'none'; };