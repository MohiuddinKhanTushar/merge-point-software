import { db, auth } from './firebase-config.js';
import { initSidebar } from './ui-manager.js';
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

    auth.onAuthStateChanged((user) => {
        if (user) {
            setupDataListeners(user.uid);
        } else {
            console.log("User not authenticated for analytics.");
        }
    });
}

function setupDataListeners(userId) {
    // 1. Listen for Active Bids
    const activeQuery = query(collection(db, "bids"), where("ownerId", "==", userId));
    onSnapshot(activeQuery, (snapshot) => {
        document.getElementById('stat-active-count').innerText = snapshot.size;
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

    // Update Text Stats
    document.getElementById('stat-win-rate').innerText = `${winRate}%`;
    document.getElementById('stat-total-won').innerText = won;
    document.getElementById('stat-total-lost').innerText = lost;

    // Prepare Chart Data
    updateCharts(won, lost, data);

    // Inside processAnalytics(data)
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
        .sort((a, b) => b[1].won - a[1].won) // Sort by most wins
        .slice(0, 5) // <--- ADD THIS: Only show the top 5 rows
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
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
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
    const ctxWL = document.getElementById('winLossChart').getContext('2d');
    const ctxInd = document.getElementById('industryChart').getContext('2d');

    if (winLossChart) winLossChart.destroy();
    if (industryChart) industryChart.destroy();

    const chartOptions = { 
        responsive: true, 
        maintainAspectRatio: true,
        layout: {
            padding: 10 // Reduced from 60 to fit the new smaller container
        },
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

    // Chart 1: Win/Loss
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

    // Chart 2: Industry Distribution
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