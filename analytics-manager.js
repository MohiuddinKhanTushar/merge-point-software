import { db } from './firebase-config.js';
import { initSidebar } from './ui-manager.js';
// NEW: Import the central gatekeeper
import { checkAuthState } from './auth.js'; 
import { 
    collection, 
    query, 
    where, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let winLossChart = null;
let industryChart = null;

export function initAnalytics() {
    initSidebar();

    // USE THE GATEKEEPER
    // This protects the page and wires up the Logout button automatically
    checkAuthState((user) => {
        if (user) {
            console.log("Analytics active for:", user.email);
            setupDataListeners(user.uid);
        }
        // No need for 'else' - checkAuthState handles the login redirect
    });
}

function setupDataListeners(userId) {
    // 1. Listen for Active Bids
    const activeQuery = query(collection(db, "bids"), where("ownerId", "==", userId));
    onSnapshot(activeQuery, (snapshot) => {
        const statEl = document.getElementById('stat-active-count');
        if (statEl) statEl.innerText = snapshot.size;
    });

    // 2. Listen for Archived RFPs (The source of our Win/Loss data)
    const archiveQuery = query(collection(db, "archived_rfps"), where("ownerId", "==", userId));
    onSnapshot(archiveQuery, (snapshot) => {
        const data = [];
        snapshot.forEach(doc => data.push(doc.data()));
        processAnalytics(data);
    });
}

function processAnalytics(data) {
    // Basic Counts
    const won = data.filter(item => item.outcome === 'won').length;
    const lost = data.filter(item => item.outcome === 'lost').length;
    const totalDecisions = won + lost;
    
    // Win Rate Calculation
    const winRate = totalDecisions > 0 ? Math.round((won / totalDecisions) * 100) : 0;

    // Update Text Stats with safety checks for elements
    const wrEl = document.getElementById('stat-win-rate');
    const wonEl = document.getElementById('stat-total-won');
    const lostEl = document.getElementById('stat-total-lost');

    if (wrEl) wrEl.innerText = `${winRate}%`;
    if (wonEl) wonEl.innerText = won;
    if (lostEl) lostEl.innerText = lost;

    // Industry Stats Processing
    const industryStats = data.reduce((acc, item) => {
        const ind = item.industry || 'Other';
        if (!acc[ind]) acc[ind] = { won: 0, total: 0 };
        acc[ind].total++;
        if (item.outcome === 'won') acc[ind].won++;
        return acc;
    }, {});

    // 1. Populate Industry Table
    const tableBody = document.getElementById('industry-table-body');
    if (tableBody) {
        tableBody.innerHTML = Object.entries(industryStats)
            .sort((a, b) => b[1].won - a[1].won) 
            .slice(0, 5) 
            .map(([name, stats]) => `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 0;"><strong>${name}</strong></td>
                    <td>${stats.won}</td>
                    <td style="text-align: right; color: #3b82f6; font-weight: 600;">
                        ${Math.round((stats.won / stats.total) * 100)}%
                    </td>
                </tr>
            `).join('');
    }

    // 2. Populate Recent Successes
    const winsList = document.getElementById('recent-wins-list');
    if (winsList) {
        const recentWins = data
            .filter(item => item.outcome === 'won')
            .slice(0, 4); 

        winsList.innerHTML = recentWins.length > 0 ? recentWins.map(win => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 8px;">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 600; font-size: 0.85rem; color: #1e293b;">
                        ${win.bidName || 'Untitled Bid'} 
                    </span>
                    <span style="font-size: 0.75rem; color: #64748b;">
                        ${win.client || 'N/A'}
                    </span>
                </div>
                <span style="font-size: 0.7rem; padding: 4px 10px; background: #dcfce7; color: #166534; border-radius: 12px; font-weight: 700;">WON</span>
            </div>
        `).join('') : '<p style="font-size: 0.8rem; color: #94a3b8;">No recent wins archived yet.</p>';
    }

    updateCharts(won, lost, data);
}

function updateCharts(won, lost, allData) {
    const canvasWL = document.getElementById('winLossChart');
    const canvasInd = document.getElementById('industryChart');
    
    if (!canvasWL || !canvasInd) return;

    const ctxWL = canvasWL.getContext('2d');
    const ctxInd = canvasInd.getContext('2d');

    if (winLossChart) winLossChart.destroy();
    if (industryChart) industryChart.destroy();

    const chartOptions = { 
        responsive: true, 
        maintainAspectRatio: true,
        layout: { padding: 10 },
        plugins: {
            legend: {
                position: 'bottom',
                labels: {
                    boxWidth: 12,
                    padding: 15,
                    font: { size: 11 }
                }
            }
        }
    };

    winLossChart = new Chart(ctxWL, {
        type: 'doughnut',
        data: {
            labels: ['Won', 'Lost'],
            datasets: [{
                data: [won, lost],
                backgroundColor: ['#22c55e', '#ef4444'],
                borderWidth: 2
            }]
        },
        options: chartOptions
    });

    const industryCounts = allData.reduce((acc, item) => {
        const ind = item.industry || 'Other';
        acc[ind] = (acc[ind] || 0) + 1;
        return acc;
    }, {});

    industryChart = new Chart(ctxInd, {
        type: 'pie',
        data: {
            labels: Object.keys(industryCounts),
            datasets: [{
                data: Object.values(industryCounts),
                backgroundColor: ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b'],
                borderWidth: 2
            }]
        },
        options: chartOptions
    });
}