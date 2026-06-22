// Variabel Global
let fanOn = false, mistOn = false;
let dbHistoryLogs = []; 
let tempChartInstance, humChartInstance;
let currentHistoryPage = 1;
const historyItemsPerPage = 10;
let currentHistoryRange = '24h'; 

// Variabel Khusus Alert
let activeAlertCount = 0;
let alertState = { tempHigh: false, humHigh: false, humLow: false };

// ========================================================
// 1. MANAJEMEN NAVIGASI HALAMAN & UI
// ========================================================
function navigate(pageId) {
    // Reset state aktif pada sidebar
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const selectedNav = document.getElementById(`nav-${pageId}`);
    if (selectedNav) selectedNav.classList.add('active');

    // Sembunyikan semua halaman, lalu tampilkan yang dipilih
    document.querySelectorAll('.page-content').forEach(page => {
        page.classList.remove('active-page');
    });
    
    const targetPage = document.getElementById('page-' + pageId);
    if(targetPage) targetPage.classList.add('active-page');

    // Ubah judul header sesuai halaman
    const titles = {
        'dashboard': ['Dashboard', 'Monitoring realtime greenhouse melon'],
        'monitoring': ['Monitoring Grafik', 'Analisis tren sensor'],
        'control': ['Control Panel', 'Pemantauan status perangkat aktuator'],
        'alerts': ['Pusat Peringatan', 'Sistem pelacakan bahaya greenhouse'],
        'history': ['Data History', 'Tabel riwayat data historis real-time']
    };
    
    if(titles[pageId]) {
        document.getElementById('pageTitle').textContent = titles[pageId][0];
        document.getElementById('pageSubtitle').textContent = titles[pageId][1];
    }
    
    // Resize grafik saat tab dibuka agar tidak hancur/mengecil
    if(pageId === 'monitoring') {
        setTimeout(() => {
            if(tempChartInstance) { tempChartInstance.resize(); tempChartInstance.update(); }
            if(humChartInstance) { humChartInstance.resize(); humChartInstance.update(); }
        }, 100);
    } 
    // Muat data saat tab history dibuka
    else if (pageId === 'history') {
        loadHistoryData(currentHistoryRange); 
    }
}

// Jam Digital Header
function tick() {
    const n = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    document.getElementById('clk').textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
}
setInterval(tick, 1000);

// ========================================================
// 2. KONEKSI DATA API REALTIME
// ========================================================
async function fetchRealtime() {
    try {
        const response = await fetch('/api/realtime');
        const msg = await response.json();

        // Update nilai kartu dashboard (Abaikan jika data awal dari Node.js masih kosong/belum ada MQTT)
        if(msg.time !== '--:--:--') {
            document.getElementById('tempVal').textContent = Number(msg.temperature).toFixed(1);
            document.getElementById('humVal').textContent = Number(msg.humidity).toFixed(1);
            document.getElementById('upd').textContent = 'Update: ' + msg.time;
            
            // Update status global aktuator (hanya monitoring)
            fanOn = msg.fanStatus;
            mistOn = msg.mistStatus;
            updateActuatorUI();
            
            // Evaluasi Alert dari data mentah realtime
            evaluateAlerts(Number(msg.temperature), Number(msg.humidity), msg.time);
        }
    } catch (error) {
        console.error("Gagal sinkronisasi data API realtime:", error);
    }
}

// Fungsi untuk memperbarui tampilan label "Menyala/Mati" di halaman Control Panel
function updateActuatorUI() {
    const fanState = document.getElementById('fanState');
    const mistState = document.getElementById('mistState');
    
    if (fanState) {
        fanState.className = 'dev-state' + (fanOn ? ' on' : ' off');
        fanState.textContent = fanOn ? '● MENYALA' : '● MATI';
    }
    
    if (mistState) {
        mistState.className = 'dev-state' + (mistOn ? ' on' : ' off');
        mistState.textContent = mistOn ? '● MENYALA' : '● MATI';
    }
}

// ========================================================
// LOGIKA ALERT DINAMIS (REALTIME)
// ========================================================
function evaluateAlerts(temp, hum, time) {
    const container = document.getElementById('alertContainer');
    if (!container) return;

    let newAlerts = 0;

    // 1. Cek Suhu Tinggi (Batas fan nyala: >= 35.0°C)
    if (temp >= 35.0 && !alertState.tempHigh) {
        createAlertItem('danger', '🔴', `Suhu Panas Kritis: ${temp.toFixed(1)}°C`, 'Batas Pemicu Kipas: 35.0°C', time);
        alertState.tempHigh = true;
        newAlerts++;
    } else if (temp < 35.0) {
        alertState.tempHigh = false; 
    }

    // 2. Cek Kelembapan Drop (Batas mist nyala: <= 50.0%)
    if (hum <= 50.0 && !alertState.humLow) {
        createAlertItem('info', '🔵', `Kelembapan Drop: ${hum.toFixed(1)}%`, 'Batas Pemicu Mist: 50.0%', time);
        alertState.humLow = true;
        newAlerts++;
    } else if (hum > 50.0) {
        alertState.humLow = false;
    }

    // 3. Cek Kelembapan Terlalu Tinggi (Batas mist mati: >= 75.0%)
    if (hum >= 75.0 && !alertState.humHigh) {
        createAlertItem('warning', '🟡', `Kelembapan Tinggi: ${hum.toFixed(1)}%`, 'Batas Atas: 75.0%', time);
        alertState.humHigh = true;
        newAlerts++;
    } else if (hum < 75.0) {
        alertState.humHigh = false;
    }

    if (newAlerts > 0) {
        updateBadgeUI(newAlerts);
    }
}

function createAlertItem(type, icon, message, limitText, time) {
    const container = document.getElementById('alertContainer');
    
    // Hapus pesan "Sistem aman" jika ada
    const emptyMsg = container.querySelector('.empty-alert');
    if (emptyMsg) emptyMsg.remove();

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert-item ${type}`;
    alertDiv.innerHTML = `
        <span style="font-size:16px">${icon}</span>
        <div>
            <div class="alert-msg">${message}</div>
            <div class="alert-time">${limitText} | Terjadi pada: ${time}</div>
        </div>
        <button class="ack-btn">✓ Konfirmasi</button>
    `;
    
    // Event listener untuk tombol Konfirmasi (menghapus alert secara individual)
    const btn = alertDiv.querySelector('.ack-btn');
    btn.addEventListener('click', () => {
        alertDiv.remove();
        updateBadgeUI(-1);
        checkEmptyAlertContainer();
    });

    container.prepend(alertDiv); // Memasukkan alert terbaru di posisi paling atas
}

function updateBadgeUI(change) {
    const badge = document.getElementById('alertBadge');
    const alertDot = document.querySelector('.hdr-alert-dot');
    
    activeAlertCount += change;
    if (activeAlertCount < 0) activeAlertCount = 0;
    
    if (badge) {
        badge.textContent = activeAlertCount;
        badge.style.display = activeAlertCount > 0 ? 'inline-block' : 'none';
    }
    if (alertDot) {
        alertDot.style.display = activeAlertCount > 0 ? 'block' : 'none';
    }
}

function checkEmptyAlertContainer() {
    const container = document.getElementById('alertContainer');
    if (container && container.children.length === 0) {
        container.innerHTML = '<div class="empty-alert" style="text-align:center; padding:20px; color:#7aaa8a; font-size:12px;">✅ Sistem aman. Tidak ada log peringatan saat ini.</div>';
    }
}

// ========================================================
// 3. TABEL RIWAYAT, PAGINATION, & DOWNLOAD CSV
// ========================================================
async function loadHistoryData(range = '24h', customStart = null, customEnd = null) {
    const loader = document.getElementById('histLoadingIndicator');
    const tbody = document.getElementById('historyTableBody');
    if(loader) loader.style.display = 'inline-block';
    
    currentHistoryRange = range; // Simpan range aktif untuk keperluan refresh
    
    let url = `/api/history?range=${range}`;
    if (range === 'custom') {
        url += `&start=${customStart}&end=${customEnd}`;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();
        
        dbHistoryLogs = data; 
        currentHistoryPage = 1; // Kembali ke halaman 1 setiap ganti filter
        renderHistoryTable();
    } catch (error) {
        if(tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 20px;">Gagal memuat log database!</td></tr>`;
    } finally {
        if(loader) loader.style.display = 'none';
    }
}

function renderHistoryTable() {
    const tbody = document.getElementById('historyTableBody');
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (!tbody) return;

    // Jika data kosong
    if (dbHistoryLogs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #7aaa8a; padding: 20px;">Tidak ada data log di rentang waktu ini.</td></tr>`;
        if(pageInfo) pageInfo.textContent = "Menampilkan 0 data";
        if(prevBtn) prevBtn.disabled = true;
        if(nextBtn) nextBtn.disabled = true;
        return;
    }

    const totalItems = dbHistoryLogs.length;
    const totalPages = Math.ceil(totalItems / historyItemsPerPage);
    
    // Pastikan halaman tidak keluar dari batas
    if (currentHistoryPage < 1) currentHistoryPage = 1;
    if (currentHistoryPage > totalPages) currentHistoryPage = totalPages;

    const startIndex = (currentHistoryPage - 1) * historyItemsPerPage;
    const endIndex = Math.min(startIndex + historyItemsPerPage, totalItems);
    const pageData = dbHistoryLogs.slice(startIndex, endIndex);

    tbody.innerHTML = '';
    pageData.forEach(log => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-family:'JetBrains Mono',monospace;">${log.time}</td>
            <td style="font-weight:600;color:#f97316">${Number(log.temp).toFixed(1)} °C</td>
            <td style="font-weight:600;color:#0ea5e9">${Number(log.hum).toFixed(1)} %</td>
            <td><span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; background:${log.fStatus ? '#f5f3ff;color:#8b5cf6':'#f1f5f9;color:#94a3b8'}">${log.fStatus ? 'AKTIF' : 'MATI'}</span></td>
            <td><span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; background:${log.mStatus ? '#ecfeff;color:#06b6d4':'#f1f5f9;color:#94a3b8'}">${log.mStatus ? 'AKTIF' : 'MATI'}</span></td>
        `;
        tbody.appendChild(row);
    });

    if(pageInfo) pageInfo.textContent = `Menampilkan ${startIndex + 1} - ${endIndex} dari ${totalItems} data (Halaman ${currentHistoryPage}/${totalPages})`;
    if(prevBtn) prevBtn.disabled = currentHistoryPage === 1;
    if(nextBtn) nextBtn.disabled = currentHistoryPage === totalPages;
}

function downloadCSV() {
    if(dbHistoryLogs.length === 0) {
        alert("Belum ada basis data historis aktual untuk diekspor!");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,Waktu Log,Suhu Udara (C),Kelembapan (%),Status Exhaust,Status Mist\n";
    dbHistoryLogs.forEach(log => {
        csvContent += `${log.time},${log.temp},${log.hum},${log.fStatus ? "AKTIF":"MATI"},${log.mStatus ? "AKTIF":"MATI"}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const downloadLink = document.createElement("a");
    downloadLink.setAttribute("href", encodedUri);
    downloadLink.setAttribute("download", `greenhouse_report.csv`);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

// ========================================================
// 4. MANAJEMEN GRAFIK DINAMIS (CHART.JS)
// ========================================================
async function loadChartData(range = '24h', customStart = null, customEnd = null) {
    const loader = document.getElementById('chartLoadingIndicator');
    if(loader) loader.style.display = 'inline-block';

    let url = `/api/chart-data?range=${range}`;
    if (range === 'custom') {
        url += `&start=${customStart}&end=${customEnd}`;
    }

    try {
        const res = await fetch(url);
        const data = await res.json();

        // Update dataset grafik suhu
        tempChartInstance.data.labels = data.labels;
        tempChartInstance.data.datasets[0].data = data.temps;
        tempChartInstance.data.datasets[1].data = Array(data.labels.length).fill(35); // Garis batas merah

        // Update dataset grafik kelembapan
        humChartInstance.data.labels = data.labels;
        humChartInstance.data.datasets[0].data = data.hums;
        humChartInstance.data.datasets[1].data = Array(data.labels.length).fill(50); // Garis batas ungu

        tempChartInstance.update();
        humChartInstance.update();
    } catch (error) {
        console.error("Gagal memuat data grafik dinamis:", error);
    } finally {
        if(loader) loader.style.display = 'none';
    }
}

function initCharts() {
    const ctxTemp = document.getElementById('tempLineChart');
    const ctxHum = document.getElementById('humLineChart');
    if(!ctxTemp || !ctxHum) return;

    // Inisialisasi awal struktur grafik
    tempChartInstance = new Chart(ctxTemp.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Suhu Udara (°C)', data: [], borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.1)', borderWidth: 2, pointRadius: 1, tension: 0.2, fill: true },
                // Label dan batas diubah:
                { label: 'Batas Kritis / Fan Aktif (35°C)', data: [], borderColor: '#ef4444', borderWidth: 1.5, borderDash: [5, 5], pointRadius: 0, fill: false }
            ]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            interaction: { mode: 'index', intersect: false },
            scales: { y: { min: 15, max: 45 }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }
        }
    });

    humChartInstance = new Chart(ctxHum.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Kelembapan (% RH)', data: [], borderColor: '#0ea5e9', backgroundColor: 'rgba(14, 165, 233, 0.1)', borderWidth: 2, pointRadius: 1, tension: 0.2, fill: true },
                // Label dan batas diubah (Batas mist aktif):
                { label: 'Batas Drop / Mist Aktif (50%)', data: [], borderColor: '#8b5cf6', borderWidth: 1.5, borderDash: [5, 5], pointRadius: 0, fill: false }
            ]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            interaction: { mode: 'index', intersect: false },
            scales: { y: { min: 30, max: 100 }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }
        }
    });

    // Panggil data pertama kali (default 24h sesuai opsi di HTML)
    loadChartData('24h');

    // Event Listeners untuk UI Filter Waktu Grafik
    const timeSelect = document.getElementById('timeRangeSelect');
    const customUI = document.getElementById('customDateContainer');
    const applyBtn = document.getElementById('applyCustomBtn');

    if(timeSelect) {
        timeSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'custom') {
                customUI.style.display = 'flex';
            } else {
                customUI.style.display = 'none';
                loadChartData(val); // Tarik data baru
            }
        });
    }

    if(applyBtn) {
        applyBtn.addEventListener('click', () => {
            const start = document.getElementById('customStart').value;
            const end = document.getElementById('customEnd').value;
            if(!start || !end) {
                alert('Harap isi rentang waktu awal dan akhir dengan lengkap!');
                return;
            }
            if(new Date(start) >= new Date(end)) {
                alert('Waktu akhir harus lebih besar dari waktu awal!');
                return;
            }
            loadChartData('custom', start, end);
        });
    }
}

// ========================================================
// 5. EVENT LISTENER GLOBAL (SAAT HALAMAN DIMUAT)
// ========================================================
document.addEventListener("DOMContentLoaded", () => {
    // 1. Jalankan komponen UI & Grafik
    initCharts();
    tick();

    checkEmptyAlertContainer();
    updateBadgeUI(0);
    
    // 2. Ambil data riwayat tabel awal dari InfluxDB
    loadHistoryData('24h');

    // 3. Mulai polling data realtime (2 detik)
    setInterval(fetchRealtime, 2000);

    // 4. Binding tombol navigasi utama
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.getAttribute('data-page');
            navigate(page);
        });
    });
    
    const bellBtn = document.getElementById('bellAlertBtn');
    if(bellBtn) bellBtn.addEventListener('click', () => navigate('alerts'));

    // 5. Binding Event Filter Waktu Tabel History
    const histSelect = document.getElementById('historyTimeSelect');
    const histCustomUI = document.getElementById('historyCustomDate');
    const histApplyBtn = document.getElementById('applyHistCustomBtn');

    if(histSelect) {
        histSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'custom') {
                histCustomUI.style.display = 'flex';
            } else {
                histCustomUI.style.display = 'none';
                loadHistoryData(val);
            }
        });
    }

    if(histApplyBtn) {
        histApplyBtn.addEventListener('click', () => {
            const start = document.getElementById('histStart').value;
            const end = document.getElementById('histEnd').value;
            if(!start || !end) return alert('Harap isi rentang waktu awal dan akhir dengan lengkap!');
            if(new Date(start) >= new Date(end)) return alert('Waktu akhir harus lebih besar dari waktu awal!');
            loadHistoryData('custom', start, end);
        });
    }

    // 6. Binding Tombol Refresh History
    const refreshHistBtn = document.getElementById('refreshHistoryBtn');
    if (refreshHistBtn) {
        refreshHistBtn.addEventListener('click', () => {
            if (currentHistoryRange === 'custom') {
                const start = document.getElementById('histStart').value;
                const end = document.getElementById('histEnd').value;
                loadHistoryData('custom', start, end);
            } else {
                loadHistoryData(currentHistoryRange);
            }
        });
    }

    // 7. Binding Event Pagination (Prev/Next)
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentHistoryPage > 1) {
                currentHistoryPage--;
                renderHistoryTable();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(dbHistoryLogs.length / historyItemsPerPage);
            if (currentHistoryPage < totalPages) {
                currentHistoryPage++;
                renderHistoryTable();
            }
        });
    }

    // 8. Binding tombol Download CSV
    const dlBtn = document.getElementById('downloadCsvBtn');
    if(dlBtn) dlBtn.addEventListener('click', downloadCSV);

});