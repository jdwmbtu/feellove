const API_KEY = 'AIzaSyAbqqoWEYouY2nlLojZIXR1MFo7C0s-gQY';
const SPREADSHEET_ID = '1whPL4X-I815XVKbeFDxEHbhHbddUtb1XwsSE7MUaWYo';
const DISCOVERY_DOCS = ['https://sheets.googleapis.com/$discovery/rest?version=v4'];
const CURRENT_DATE = new Date();
const storeColumns = { CAFE: 3, FEELLOVE: 4, SNOW: 5, ZION: 6 };

let netsalesData = null;
let ordersData = null;
let growthTarget = 20;
let growthType = 'number';
let isAdjusted = true;
let lastModifiedTime = null;
let currentMetricsSubView = 'sales';  // Default sub-view
let totalStaffingHours = 0;   // will be set by loadTodaySchedule
let nextDayPredictedSales = 0;   // will hold the first day sales from 7-day table


/* -------------------------------------------------------------
   INITIAL LOAD
   ------------------------------------------------------------- */
function initClient() {
    gapi.load('client', () => {
        gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS })
            .then(() => loadSheetsData())
            .then(refreshed => {
                if (refreshed) populateMonthDropdown();
                updateTables();
            })
            .catch(err => {
                console.error('Init error:', err);
                setStatus('Init error');
            });
    });
}

/* -------------------------------------------------------------
   FETCH DATA + VERSION CHECK
   ------------------------------------------------------------- */
async function loadSheetsData() {
    try {
        const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const modified = meta.result.modifiedTime;

        if (lastModifiedTime && lastModifiedTime === modified) {
            setStatus('Data up-to-date (cached)');
            return false;
        }

        const netResp = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Net Sales!A2:G'
        });
        netsalesData = netResp.result.values || [];

        const ordResp = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Orders!A2:G'
        });
        ordersData = ordResp.result.values || [];

        lastModifiedTime = modified;

        // Show last non-zero data date
        const lastDate = getLastDataDate(
            document.getElementById('store-filter')?.value || 'CAFE',
            document.getElementById('month-filter')?.value || ''
        );
        const dateStr = lastDate
            ? lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'unknown';
        setStatus(`Updated with fresh data through ${dateStr}`);

        // Update counts
        const countEls = ['netsales-count', 'orders-count', 'aov-count', 'daycount-count', 'forecast-count'];
        countEls.forEach(id => {
            const el = document.getElementById(id);
        });

        return true;
    } catch (e) {
        console.error('loadSheetsData error:', e);
        setStatus('Error loading data');
        return false;
    }
}

/* -------------------------------------------------------------
   Helper – set status in controls table
   ------------------------------------------------------------- */
function setStatus(txt) {
    const cell = document.getElementById('status-cell');
    if (cell) cell.innerText = txt;
}

/* -------------------------------------------------------------
   HELPER – most recent non-zero date
   ------------------------------------------------------------- */
function getLastDataDate(store, month) {
    const idx = storeColumns[store];
    let last = null;

    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (isNaN(d)) return;
        if (month && d.toLocaleString('en-US', { month: 'long' }) !== month) return;

        const v = row[idx];
        if (!v || v.toString().trim() === '') return;
        const num = parseFloat(v.toString().replace(/[^0-9.-]+/g, '')) || 0;
        if (num === 0) return;

        if (!last || d > last) last = d;
    });
    return last;
}

/* -------------------------------------------------------------
   MONTH DROPDOWN – CHRONOLOGICAL ORDER
   ------------------------------------------------------------- */
function populateMonthDropdown() {
    const monthOrder = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const seen = new Set();

    // Collect unique months from data
    netsalesData.forEach(r => {
        const d = new Date(r[2]);
        if (isNaN(d) || d > CURRENT_DATE) return;
        const m = d.toLocaleString('en-US', { month: 'long' });
        seen.add(m);
    });

    // Sort by monthOrder
    const months = Array.from(seen).sort((a, b) => monthOrder.indexOf(a) - monthOrder.indexOf(b));

    const sel = document.getElementById('month-filter');
    if (!sel) return;
    sel.innerHTML = '<option value="">All Months</option>';
    months.forEach(m => sel.innerHTML += `<option value="${m}">${m}</option>`);
}

/* -------------------------------------------------------------
   GROWTH TARGET
   ------------------------------------------------------------- */
function updateGrowthTarget() {
    const valSel = document.getElementById('growth-target');
    if (!valSel) return;

    const selected = valSel.options[valSel.selectedIndex];
    const value = selected.value;
    const text = selected.textContent.trim();

    if (text.includes('$') || text.includes('K')) {
        growthType = 'dollar';
        growthTarget = parseFloat(value.replace('K', ''));
    } else {
        growthType = 'percent';
        growthTarget = parseFloat(value);
    }

}
/* -------------------------------------------------------------
   UPDATE FORECAST BUTTON
   ------------------------------------------------------------- */
async function refreshAndUpdateForecast() {
    const month = document.getElementById('month-filter')?.value;
    const store = document.getElementById('store-filter')?.value;

    if (!month || !store) {
        alert('Select Month and Store first');
        return;
    }

    setStatus('Checking for updates...');
    const refreshed = await loadSheetsData();

    if (refreshed) {
        populateMonthDropdown();
        document.getElementById('month-filter').value = month;
        document.getElementById('store-filter').value = store;
        updateGrowthTarget();
    }

    updateTables();
    setStatus(refreshed ? 'Updated with fresh data' : 'No changes – used cache');
}

/* -------------------------------------------------------------
   MAIN UPDATE
   ------------------------------------------------------------- */
function updateTables() {
    const month = document.getElementById('month-filter')?.value || '';
    const store = document.getElementById('store-filter')?.value || 'CAFE';
    isAdjusted = document.getElementById('adjusted-toggle')?.checked || false;

    const avgs = calculateAverages(store, month);
    updateCombinedMetricsTable(store, month);
    updateSevenDayPredictionTable(store, month);  // NEW
    updateDayCountTable(store, month);
    updateForecastTable(store, month);
    updateScenariosTable(store, month);
    updateSummaryTable(store, month);
// Refresh current chart if active
if (window.currentChart) {
    const activeSection = window.activeSection || 'metrics-h2';
    const container = document.getElementById('chart-container');
    if (container) container.innerHTML = ''; // Clear old content
    updateChartForSection(activeSection);
}
// Refresh Next Day view if active
if (window.activeView === 'next-day') {
    const container = document.getElementById('chart-container');
    if (container) container.innerHTML = ''; // Clear old content
    updateChartForSummaryRow('next-day');
}
// Refresh MTD Growth view if active
if (window.activeView === 'mtd-growth') {
    const container = document.getElementById('chart-container');
    if (container) container.innerHTML = ''; // Clear old content
    updateChartForSummaryRow('mtd-growth');
}
// Refresh Remaining Target view if active
if (window.activeView === 'remaining-target') {
    const container = document.getElementById('chart-container');
    if (container) container.innerHTML = ''; // Clear old content
    updateChartForSummaryRow('remaining-target');
}

}

/* -------------------------------------------------------------
   AVERAGE CALCULATION
   ------------------------------------------------------------- */
function calculateAverages(store, month) {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const s24 = {}, s25 = {}, o24 = {}, o25 = {};
    days.forEach(d => { s24[d]=[]; s25[d]=[]; o24[d]=[]; o25[d]=[]; });

    for (let i = 0; i < netsalesData.length && i < ordersData.length; i++) {
        const sRow = netsalesData[i];
        const oRow = ordersData[i];
        const dt = new Date(sRow[2]);
        if (isNaN(dt)) continue;

        const m = dt.toLocaleString('en-US', { month: 'long' });
        const y = dt.getFullYear();
        const salesVal = sRow[storeColumns[store]];
        const orderVal = oRow[storeColumns[store]];

        if (!salesVal || !orderVal) continue;
        const sales = typeof salesVal === 'string' ? parseFloat(salesVal.replace(/[^0-9.-]+/g,'')) || 0 : salesVal;
        const orders = parseFloat(orderVal) || 0;
        if (isNaN(sales) || isNaN(orders)) continue;

        if (!month || m === month) {
            const day = sRow[0];
            if (y === 2024) { s24[day].push(sales); o24[day].push(orders); }
            else if (y === 2025) { s25[day].push(sales); o25[day].push(orders); }
        }
    }
    return { salesAverages2024: s24, salesAverages2025: s25, ordersAverages2024: o24, ordersAverages2025: o25 };
}

/* -------------------------------------------------------------
   7-DAY PREDICTION TABLE – VERTICAL (7 ROWS)
   ------------------------------------------------------------- */
function updateSevenDayPredictionTable(store, month) {
    const container = document.getElementById('seven-day-prediction-container');
    if (!container) return;

    const tbody = container.querySelector('tbody');
    tbody.innerHTML = '';

    // Find last non-zero day (sales or orders)
    let lastNonZeroDate = null;
    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (isNaN(d)) return;

        const sales = parseFloat(row[storeColumns[store]]) || 0;
        const orderRow = ordersData.find(o => new Date(o[2]).getTime() === d.getTime());
        const orders = orderRow ? parseFloat(orderRow[storeColumns[store]]) || 0 : 0;

        if (sales > 0 || orders > 0) {
            if (!lastNonZeroDate || d > lastNonZeroDate) {
                lastNonZeroDate = d;
            }
        }
    });

    // Start from next day after last non-zero
    const startDate = lastNonZeroDate ? new Date(lastNonZeroDate) : new Date();
    startDate.setDate(startDate.getDate() + 1);

    // Build 7 days
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        days.push(d);
    }

    // Header row
    tbody.innerHTML += '<tr><th>Date</th><th style="text-align:right;">Net Sales</th><th style="text-align:right;">Orders</th></tr>';

    // One row per day
    days.forEach((d, i) => {
        const dateStr = d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const salesId = `pred-sales-${i}`;
        const ordersId = `pred-orders-${i}`;
        tbody.innerHTML += `<tr>
            <td style="font-weight:bold;">${dateStr}</td>
            <td id="${salesId}" style="text-align:right;">—</td>
            <td id="${ordersId}" style="text-align:right;">—</td>
        </tr>`;
    });

    // Store dates for algo
    window.predictionDates = days;

    // === PREDICT ORDERS ===
    const dayAverages = {};
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    daysOfWeek.forEach(d => dayAverages[d] = { past3: [], lastYear: 0 });

    ordersData.forEach(row => {
        const d = new Date(row[2]);
        if (d >= startDate) return;
        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const orders = parseFloat(row[storeColumns[store]]) || 0;
        if (orders > 0) {
            dayAverages[dayName].past3.push(orders);
        }
    });

    const targetWeekStart = new Date(startDate);
    targetWeekStart.setDate(targetWeekStart.getDate() - 7);
    const lastYearWeek = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(targetWeekStart);
        d.setDate(d.getDate() + i);
        const row = ordersData.find(r => {
            const rd = new Date(r[2]);
            return rd.getFullYear() === 2024 && rd.getTime() === d.getTime();
        });
        lastYearWeek.push(row ? parseFloat(row[storeColumns[store]]) || 0 : 0);
    }
    const lastYearWeekAvg = lastYearWeek.length > 0 ? lastYearWeek.reduce((a, b) => a + b, 0) / lastYearWeek.length : 1;

    days.forEach((d, i) => {
        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const past3 = dayAverages[dayName].past3.slice(-3);
        const avgPast3 = past3.length > 0 ? past3.reduce((a, b) => a + b, 0) / past3.length : 0;
        const lastYearDay = lastYearWeek[i] || avgPast3;
        const shape = lastYearWeekAvg > 0 ? lastYearDay / lastYearWeekAvg : 1;
        const predicted = Math.round(avgPast3 * shape);
        document.getElementById(`pred-orders-${i}`).textContent = predicted;
    });

    // === PREDICT NET SALES USING DAILY AOV ===
    const avgs = calculateAverages(store, month);
    const dayAOV = {};
    daysOfWeek.forEach(dayName => {
        const o25 = avgs.ordersAverages2025[dayName].length ? Math.round(avgs.ordersAverages2025[dayName].reduce((a,b)=>a+b,0)/avgs.ordersAverages2025[dayName].length) : 0;
        const s25 = avgs.salesAverages2025[dayName].length ? Math.round(avgs.salesAverages2025[dayName].reduce((a,b)=>a+b,0)/avgs.salesAverages2025[dayName].length) : 0;
        const o24 = avgs.ordersAverages2024[dayName].length ? Math.round(avgs.ordersAverages2024[dayName].reduce((a,b)=>a+b,0)/avgs.ordersAverages2024[dayName].length) : 0;
        const s24 = avgs.salesAverages2024[dayName].length ? Math.round(avgs.salesAverages2024[dayName].reduce((a,b)=>a+b,0)/avgs.salesAverages2024[dayName].length) : 0;
        const aov25 = o25 > 0 ? s25 / o25 : 0;
        const aov24 = o24 > 0 ? s24 / o24 : 0;
        dayAOV[dayName] = o25 > 0 ? aov25 : aov24;
    });

days.forEach((d, i) => {
        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const aov = dayAOV[dayName] || 0;
        const predictedOrders = parseInt(document.getElementById(`pred-orders-${i}`).textContent) || 0;
        const predictedSales = Math.round(predictedOrders * aov);
        document.getElementById(`pred-sales-${i}`).textContent = formatNumber(predictedSales);

        // Save the first day's (i === 0) predicted sales for Summary table
        if (i === 0) {
            nextDayPredictedSales = predictedSales;
        }
    });
}


/* -------------------------------------------------------------
   COMBINED METRICS TABLE
   ------------------------------------------------------------- */
function updateCombinedMetricsTable(store, month) {
    const avgs = calculateAverages(store, month);
    const tbody = document.getElementById('metrics-table')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

    days.forEach(d => {
        const s24 = avgs.salesAverages2024[d].length ? Math.round(avgs.salesAverages2024[d].reduce((a,b)=>a+b,0)/avgs.salesAverages2024[d].length) : 0;
        const s25 = avgs.salesAverages2025[d].length ? Math.round(avgs.salesAverages2025[d].reduce((a,b)=>a+b,0)/avgs.salesAverages2025[d].length) : 0;
        const o24 = avgs.ordersAverages2024[d].length ? Math.round(avgs.ordersAverages2024[d].reduce((a,b)=>a+b,0)/avgs.ordersAverages2024[d].length) : 0;
        const o25 = avgs.ordersAverages2025[d].length ? Math.round(avgs.ordersAverages2025[d].reduce((a,b)=>a+b,0)/avgs.ordersAverages2025[d].length) : 0;
        const aov24 = o24 > 0 ? s24 / o24 : 0;
        const aov25 = o25 > 0 ? s25 / o25 : 0;

        const deltaSales = s25 - s24;
        const pctSales = s24 > 0 ? (deltaSales / s24) * 100 : (s25 > 0 ? '∞' : 0);
        const deltaOrders = o25 - o24;
        const pctOrders = o24 > 0 ? (deltaOrders / o24) * 100 : (o25 > 0 ? '∞' : 0);
        const deltaAOV = aov25 - aov24;
        const pctAOV = aov24 > 0 ? (deltaAOV / aov24) * 100 : (aov25 > 0 ? '∞' : 0);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${d}</td>
            <td>${formatNumber(s24)}</td>
            <td>${formatNumber(s25)}</td>
            <td>${formatNumber(deltaSales)}</td>
            <td>${formatPercent(pctSales)}</td>
            <td>${o24}</td>
            <td>${o25}</td>
            <td>${deltaOrders}</td>
            <td>${formatPercent(pctOrders)}</td>
            <td>${formatNumber(aov24, true)}</td>
            <td>${formatNumber(aov25, true)}</td>
            <td>${formatNumber(deltaAOV, true)}</td>
            <td>${formatPercent(pctAOV)}</td>
        `;
        tbody.appendChild(row);
    });
         // === SUMMARY ROWS ===
    let totalSales24 = 0, totalOrders24 = 0, totalSales25 = 0, totalOrders25 = 0;

    days.forEach(d => {
        const s24 = avgs.salesAverages2024[d].length ? Math.round(avgs.salesAverages2024[d].reduce((a,b)=>a+b,0)/avgs.salesAverages2024[d].length) : 0;
        const o24 = avgs.ordersAverages2024[d].length ? Math.round(avgs.ordersAverages2024[d].reduce((a,b)=>a+b,0)/avgs.ordersAverages2024[d].length) : 0;
        const s25 = avgs.salesAverages2025[d].length ? Math.round(avgs.salesAverages2025[d].reduce((a,b)=>a+b,0)/avgs.salesAverages2025[d].length) : 0;
        const o25 = avgs.ordersAverages2025[d].length ? Math.round(avgs.ordersAverages2025[d].reduce((a,b)=>a+b,0)/avgs.ordersAverages2025[d].length) : 0;

        totalSales24 += s24;
        totalOrders24 += o24;
        totalSales25 += s25;
        totalOrders25 += o25;
    });

    const avgAOV24 = totalOrders24 > 0 ? totalSales24 / totalOrders24 : 0;
    const avgAOV25 = totalOrders25 > 0 ? totalSales25 / totalOrders25 : 0;

    // NEW: Check if all 7 days have data (at least one entry in 2024 or 2025 averages for this month)
    const hasFullWeekData = days.every(d => 
         avgs.salesAverages2025[d].length > 0
    );

    if (hasFullWeekData) {
        const summaryRow = document.createElement('tr');
        summaryRow.style.fontWeight = 'bold';
        summaryRow.style.backgroundColor = '#f0f0f0';
        summaryRow.innerHTML = `
            <td><strong>Weekly</strong></td>
            <td>${formatNumber(totalSales24)}</td>
            <td>${formatNumber(totalSales25)}</td>
            <td>${formatNumber(totalSales25 - totalSales24)}</td>
            <td>${formatPercent(totalSales24 > 0 ? ((totalSales25 - totalSales24) / totalSales24) * 100 : 0)}</td>
            <td>${totalOrders24}</td>
            <td>${totalOrders25}</td>
            <td>${totalOrders25 - totalOrders24}</td>
            <td>${formatPercent(totalOrders24 > 0 ? ((totalOrders25 - totalOrders24) / totalOrders24) * 100 : 0)}</td>
            <td>${formatNumber(avgAOV24, true)}</td>
            <td>${formatNumber(avgAOV25, true)}</td>
            <td>${formatNumber(avgAOV25 - avgAOV24, true)}</td>
            <td>${formatPercent(avgAOV24 > 0 ? ((avgAOV25 - avgAOV24) / avgAOV24) * 100 : 0)}</td>
        `;
        tbody.appendChild(summaryRow);
    }


     // === MONTHLY TOTALS ROW ===
    const data = calculateSalesData(store, month);
    const shift = isAdjusted ? 1 : 0;
    const monthlySales24 = data.mtd2024;
    const monthlySales25 = data.mtd2025;

    // SAME EXACT LOGIC AS NET SALES MTD — BUT FOR ORDERS
    const monthlyOrders24 = ordersData.reduce((s, r) => {
        const d = new Date(r[2]);
        if (d.getFullYear() !== 2024 || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
        const day = d.getDate();
        if (day < (1 + shift) || day > (data.elapsedDays + shift)) return s;
        const v = r[storeColumns[store]];
        return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
    }, 0);

    const monthlyOrders25 = ordersData.reduce((s, r) => {
        const d = new Date(r[2]);
        if (d.getFullYear() !== 2025 || d > data.last2025 || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
        const v = r[storeColumns[store]];
        return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
    }, 0);

    const monthlyAOV24 = monthlyOrders24 > 0 ? monthlySales24 / monthlyOrders24 : 0;
    const monthlyAOV25 = monthlyOrders25 > 0 ? monthlySales25 / monthlyOrders25 : 0;

    const monthlyRow = document.createElement('tr');
    monthlyRow.style.fontWeight = 'bold';
    monthlyRow.style.backgroundColor = '#e6e6e6';
    monthlyRow.innerHTML = `
        <td><strong>Month to Date</strong></td>
        <td>${formatNumber(monthlySales24)}</td>
        <td>${formatNumber(monthlySales25)}</td>
        <td>${formatNumber(monthlySales25 - monthlySales24)}</td>
        <td>${formatPercent(monthlySales24 > 0 ? ((monthlySales25 - monthlySales24) / monthlySales24) * 100 : 0)}</td>
        <td>${monthlyOrders24}</td>
        <td>${monthlyOrders25}</td>
        <td>${monthlyOrders25 - monthlyOrders24}</td>
        <td>${formatPercent(monthlyOrders24 > 0 ? ((monthlyOrders25 - monthlyOrders24) / monthlyOrders24) * 100 : 0)}</td>
        <td>${formatNumber(monthlyAOV24, true)}</td>
        <td>${formatNumber(monthlyAOV25, true)}</td>
        <td>${formatNumber(monthlyAOV25 - monthlyAOV24, true)}</td>
        <td>${formatPercent(monthlyAOV24 > 0 ? ((monthlyAOV25 - monthlyAOV24) / monthlyAOV24) * 100 : 0)}</td>
    `;
    tbody.appendChild(monthlyRow);
}


/* -------------------------------------------------------------
   DAY COUNT TABLE
   ------------------------------------------------------------- */
function updateDayCountTable(store, month) {
    const tbody = document.getElementById('daycount-table')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const categories = ['Weekdays', 'Weekends'];
    const lastYear = { Weekdays: 0, Weekends: 0 };
    const currentElapsed = { Weekdays: 0, Weekends: 0 };
    const currentRemaining = { Weekdays: 0, Weekends: 0 };

    let lastRecordedDate = null;

    // Count 2024 and 2025 data
    netsalesData.forEach(row => {
        const date = new Date(row[2]);
        if (isNaN(date)) return;

        const rowMonth = date.toLocaleString('en-US', { month: 'long' });
        if (month && rowMonth !== month) return;

        const value = row[storeColumns[store]];
        if (!value || value.toString().trim() === '') return;

        const year = date.getFullYear();
        const dayIndex = date.getDay();

        if (year === 2024) {
            if (dayIndex >= 1 && dayIndex <= 5) lastYear.Weekdays++;
            else lastYear.Weekends++;
        } else if (year === 2025) {
            if (dayIndex >= 1 && dayIndex <= 5) currentElapsed.Weekdays++;
            else currentElapsed.Weekends++;

            if (!lastRecordedDate || date > lastRecordedDate) lastRecordedDate = date;
        }
    });

    // For future months: no 2025 data → elapsed = 0, remaining = full month
    if (month && !lastRecordedDate) {
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        const lastDayOfMonth = new Date(2025, monthIndex + 1, 0).getDate();

        for (let d = 1; d <= lastDayOfMonth; d++) {
            const date = new Date(2025, monthIndex, d);
            const dayIndex = date.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) currentRemaining.Weekdays++;
            else currentRemaining.Weekends++;
        }
    } else if (month && lastRecordedDate) {
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        const lastDayOfMonth = new Date(2025, monthIndex + 1, 0).getDate();

        for (let d = lastRecordedDate.getDate() + 1; d <= lastDayOfMonth; d++) {
            const date = new Date(2025, monthIndex, d);
            const dayIndex = date.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) currentRemaining.Weekdays++;
            else currentRemaining.Weekends++;
        }
    }

    categories.forEach(cat => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${cat}</td>
            <td>${lastYear[cat] || 0}</td>
            <td>${currentElapsed[cat] || 0}</td>
            <td>${currentRemaining[cat] || 0}</td>
        `;
        tbody.appendChild(row);
    });

    const totalLast = lastYear.Weekdays + lastYear.Weekends;
    const totalElapsed = currentElapsed.Weekdays + currentElapsed.Weekends;
    const totalRemaining = currentRemaining.Weekdays + currentRemaining.Weekends;
    const totalRow = document.createElement('tr');
    totalRow.style.fontWeight = 'bold';
    totalRow.innerHTML = `
        <td><strong>Total</strong></td>
        <td><strong>${totalLast}</strong></td>
        <td><strong>${totalElapsed}</strong></td>
        <td><strong>${totalRemaining}</strong></td>
    `;
    tbody.appendChild(totalRow);
}

/* -------------------------------------------------------------
   SIMPLE FORECAST
   ------------------------------------------------------------- */
function updateForecastTable(store, month) {
    const tbody = document.getElementById('forecast-table')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const data = calculateSalesData(store, month);

    const rows = [
        { label: `${month} 2024`, mtd: data.mtd2024, rom: data.rom2024 },
        { label: `${month} Growth Target ${growthTarget}${growthType === 'dollar' ? 'K' : '%'} `, mtd: data.mtdTarget, rom: data.romTarget },
        { label: `${month} 2025`, mtd: data.mtd2025, rom: data.rom2025 }
    ];

    rows.forEach(r => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${r.label}</td>
            <td>${formatNumber(r.mtd)}</td>
            <td>${r.rom === 0 ? '—' : formatNumber(r.rom)}</td>
        `;
        tbody.appendChild(row);
    });
}
/* -------------------------------------------------------------
   SCENARIOS TABLE
   ------------------------------------------------------------- */
function updateScenariosTable(store, month) {
    const tbody = document.getElementById('scenarios-table')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const data = calculateSalesData(store, month);
    const mtd2025 = data.mtd2025;
    const overallTarget = data.mtdTarget + data.romTarget;

    const mtdGrowthPct = data.mtd2024 > 0 ? ((data.mtd2025 / data.mtd2024) - 1) * 100 : 0;

    const scenarios = [
        { label: `${month} ${new Date().getFullYear() - 1} Repeats`, rom: data.rom2024 },
        { label: `${month} ${new Date().getFullYear()} at ${growthTarget}${growthType === 'dollar' ? 'K' : '%'} Growth Rate`, rom: data.romTarget },
        { label: `${month} ${new Date().getFullYear()} at Current Rate ${formatPercent(mtdGrowthPct)}`, rom: data.rom2025 }
    ];

    // MTD merged row
    const mtdRow = document.createElement('tr');
    mtdRow.innerHTML = `
        <td rowspan="${scenarios.length+1}" style="vertical-align: middle; text-align: center; font-weight: bold;">
            ${formatNumber(mtd2025)}
        </td>
    `;
    tbody.appendChild(mtdRow);

    // Scenario rows
    scenarios.forEach(scenario => {
        const total = mtd2025 + scenario.rom;
        const diff = total - overallTarget;
        const color = diff >= 0 ? 'green' : 'red';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${scenario.label}</td>
            <td style="text-align:right;">${formatNumber(scenario.rom)}</td>
            <td style="text-align:right; color:${color};">${formatNumber(total)}</td>
            <td style="text-align:right; color:${color};">${diff >= 0 ? '+' : ''}${formatNumber(diff)}</td>
        `;
        tbody.appendChild(row);
    });
}

/* -------------------------------------------------------------
   CALCULATE SALES DATA
   ------------------------------------------------------------- */
function calculateSalesData(store, month) {
    const idx = storeColumns[store];
    const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
    const totalDays = new Date(2025, monthIndex + 1, 0).getDate();
    const shift = isAdjusted ? 1 : 0;

    const now = new Date();
    const lastDay2025 = new Date(2025, monthIndex + 1, 0);
    const monthEnded = now > lastDay2025;

    let last2025 = null;
    let mtd2025 = 0;
    let isMonthStarted = false;

    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (isNaN(d) || d.getFullYear() !== 2025 || d.toLocaleString('en-US',{month:'long'}) !== month) return;
        const v = row[idx];
        if (!v || v.toString().trim() === '') return;

        isMonthStarted = true;
        mtd2025 += parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0);
        if (!last2025 || d > last2025) last2025 = d;
    });

    // Allow future months in 2025 to show target
    if (!isMonthStarted && monthIndex >= CURRENT_DATE.getMonth() && CURRENT_DATE.getFullYear() === 2025) {
        isMonthStarted = true;
        mtd2025 = 0;
        last2025 = null; // no data → first day of month
    }

    if (!isMonthStarted) {
        const full2024 = netsalesData.reduce((s, r) => {
            const d = new Date(r[2]);
            if (d.getFullYear() !== 2024 || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
            const day = d.getDate();
            if (day < (1 + shift) || day > (totalDays + shift)) return s;

            const v = r[idx];
            if (!v || v.toString().trim() === '') return s;

            if (shift === 1 && day === 1) {
                const nextMonthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][(monthIndex + 1) % 12];
                if (d.toLocaleString('en-US', { month: 'long' }) === nextMonthName) {
                    return s + (parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0));
                }
            }
            return s + (parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0));
        }, 0);

        const growthAmount = growthTarget * 1000;
let romTarget = growthType === 'percent' ? rom2024 * (1 + growthTarget / 100) : rom2024 + growthAmount;
        return {
            mtd2024: 0, mtd2025: 0, mtdTarget: 0,
            rom2024: Math.round(full2024), rom2025: 0, romTarget: Math.round(romTarget)
        };
    }

    if (monthEnded && last2025 && last2025 >= lastDay2025) {
        const mtd2024 = netsalesData.reduce((s, r) => {
            const d = new Date(r[2]);
            if (d.getFullYear() !== 2024 || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
            const day = d.getDate();
            if (day < (1 + shift) || day > (totalDays + shift)) return s;

            const v = r[idx];
            if (!v || v.toString().trim() === '') return s;

            if (shift === 1 && day === 1) {
                const nextMonthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][(monthIndex + 1) % 12];
                if (d.toLocaleString('en-US', { month: 'long' }) === nextMonthName) {
                    return s + (parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0));
                }
            }
            return s + (parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0));
        }, 0);

        let mtdTarget;
        if (growthType === 'percent') {
            mtdTarget = mtd2024 * (1 + growthTarget / 100);
        } else {
            const growthAmount = growthTarget * 1000;
            mtdTarget = mtd2024 + growthAmount;
        }

        return {
            mtd2024: Math.round(mtd2024),
            mtd2025: Math.round(mtd2025),
            mtdTarget: Math.round(mtdTarget),
            rom2024: 0, rom2025: 0, romTarget: 0
        };
    }

    const elapsedDays = last2025 ? last2025.getDate() : 0;

    mtd2025 = netsalesData.reduce((s, r) => {
        const d = new Date(r[2]);
        if (d.getFullYear() !== 2025 || d > last2025 || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
        const v = r[idx];
        return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
    }, 0);

    const mtd2024 = netsalesData.reduce((s, r) => {
        const d = new Date(r[2]);
        if (d.getFullYear() !== 2024 || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
        const day = d.getDate();
        if (day < (1 + shift) || day > (elapsedDays + shift)) return s;
        const v = r[idx];
        return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
    }, 0);

    const rom2024 = netsalesData.reduce((s, r) => {
        const d = new Date(r[2]);
        if (d.getFullYear() !== 2024) return s;
        const rowMonth = d.toLocaleString('en-US', { month: 'long' });
        const day = d.getDate();

        if (rowMonth === month && day > (elapsedDays + shift) && day <= (totalDays + shift)) {
            const v = r[idx];
            return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
        }

        if (shift === 1 && day === 1) {
            const nextMonthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][(monthIndex + 1) % 12];
            if (rowMonth === nextMonthName) {
                const v = r[idx];
                return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
            }
        }
        return s;
    }, 0);

    let mtdTarget, romTarget;
    const total2024 = mtd2024 + rom2024;
    const growthAmount = growthTarget * 1000;

    if (growthType === 'percent') {
        const factor = 1 + growthTarget / 100;
        mtdTarget = mtd2024 * factor;
        romTarget = rom2024 * factor;
        } else {
        const growthAmount = growthTarget * 1000;

        // Calculate average sales per weekday in 2024 for the month
        const dayAverages = {};
        const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
        days.forEach(d => dayAverages[d] = 0);

        let count = {};
        days.forEach(d => count[d] = 0);

        netsalesData.forEach(row => {
            const d = new Date(row[2]);
            if (d.getFullYear() !== 2024 || 
                d.toLocaleString('en-US', { month: 'long' }) !== month) return;

            const dayName = d.toLocaleString('en-US', { weekday: 'long' });
            const cell = row[storeColumns[store]];
            const sales = (cell != null && cell.toString().trim() !== '') 
                ? parseFloat(cell.toString().replace(/[^0-9.-]+/g, '')) || 0 
                : 0;

            dayAverages[dayName] += sales;
            count[dayName]++;
        });

        days.forEach(d => {
            dayAverages[d] = count[d] > 0 ? dayAverages[d] / count[d] : 0;
        });

        // Count how many of each weekday in the month
        const monthDayCount = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
        for (let d = 1; d <= totalDays; d++) {
            const date = new Date(2025, monthIndex, d);
            const dayName = date.toLocaleString('en-US', { weekday: 'long' });
            monthDayCount[dayName]++;
        }

        // Total expected sales for full month
        let totalExpected = 0;
        days.forEach(d => {
            totalExpected += dayAverages[d] * monthDayCount[d];
        });

        // MTD and ROM expected sales
        let mtdExpected = 0;
        let romExpected = 0;

        for (let d = 1; d <= totalDays; d++) {
            const date = new Date(2025, monthIndex, d);
            const dayName = date.toLocaleString('en-US', { weekday: 'long' });
            const expected = dayAverages[dayName];

            if (d <= elapsedDays) {
                mtdExpected += expected;
            } else {
                romExpected += expected;
            }
        }

        // Prorate growth
        const mtdShare = totalExpected > 0 ? mtdExpected / totalExpected : 0;
        const romShare = totalExpected > 0 ? romExpected / totalExpected : 0;

        mtdTarget = Math.round(mtd2024 + growthAmount * mtdShare);
        romTarget = Math.round(rom2024 + growthAmount * romShare);
    }

    mtdTarget = Math.round(mtdTarget);
    romTarget = Math.round(romTarget);

    const rom2025 = mtd2024 > 0 ? rom2024 * (mtd2025 / mtd2024) : 0;

    return {
        mtd2024: Math.round(mtd2024),
        mtd2025: Math.round(mtd2025),
        mtdTarget: mtdTarget,
        rom2024: Math.round(rom2024),
        rom2025: Math.round(rom2025),
        romTarget: romTarget,
        elapsedDays: elapsedDays,
        last2025: last2025  // ADD THIS
    };
}

/* -------------------------------------------------------------
   FORMATTING
   ------------------------------------------------------------- */
function formatNumber(v, aov = false) {
    if (v === 0) return aov ? '$0.00' : '$0';
    const abs = Math.abs(v);
    let fmt;
    if (aov) {
        fmt = abs.toFixed(2);
    } else {
        fmt = Math.round(abs).toLocaleString('en-US'); // $xx,xxx
    }
    return v < 0 ? `<span class="negative">($${fmt})</span>` : `$${fmt}`;
}

function formatPercent(v) {
    if (v === '∞') return v;
    if (v === 0) return '0.0%';
    const fmt = Math.abs(v).toFixed(1);
    return v < 0 ? `<span class="negative">(${fmt}%)</span>` : `${fmt}%`;
}

function updateChartForSection(sectionId) {
    const store = document.getElementById('store-filter').value || 'CAFE';
    const month = document.getElementById('month-filter').value || '';
   let canvas;
const container = document.getElementById('chart-container');
if (!container) return;
container.innerHTML = ''; // Always clear first
const newCanvas = document.createElement('canvas');
newCanvas.id = 'dynamic-chart';
newCanvas.width = 400;
newCanvas.height = 300;
container.appendChild(newCanvas);
console.log('Canvas always recreated and appended, now in DOM?', !!document.getElementById('dynamic-chart'));
canvas = document.getElementById('dynamic-chart');
if (!canvas) return; // Safety
container.offsetHeight; // Force reflow
canvas.style.display = 'block';
const ctx = canvas.getContext('2d');
    console.log(`Creating chart for ${sectionId}: canvas exists in DOM?`, !!document.getElementById('dynamic-chart'));
    // Destroy previous chart
    if (window.currentChart) {
        window.currentChart.destroy();
    }
    let chartType = 'bar';
    let labels = [];
    let datasets = [];
    switch (sectionId) {
        case 'metrics-h2':
    // Bar chart: 2024 vs 2025 by day of week (Sales/Orders/AOV based on sub-view)
    const avgs = calculateAverages(store, month);
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let data2024 = [], data2025 = [], subViewTitle = '';
    if (currentMetricsSubView === 'orders') {
        data2024 = days.map(d => avgs.ordersAverages2024[d].length ? Math.round(avgs.ordersAverages2024[d].reduce((a, b) => a + b, 0) / avgs.ordersAverages2024[d].length) : 0);
        data2025 = days.map(d => avgs.ordersAverages2025[d].length ? Math.round(avgs.ordersAverages2025[d].reduce((a, b) => a + b, 0) / avgs.ordersAverages2025[d].length) : 0);
        subViewTitle = 'Orders';
    } else if (currentMetricsSubView === 'aov') {
        data2024 = days.map(d => {
            const s24 = avgs.salesAverages2024[d].length ? Math.round(avgs.salesAverages2024[d].reduce((a, b) => a + b, 0) / avgs.salesAverages2024[d].length) : 0;
            const o24 = avgs.ordersAverages2024[d].length ? Math.round(avgs.ordersAverages2024[d].reduce((a, b) => a + b, 0) / avgs.ordersAverages2024[d].length) : 0;
            return o24 > 0 ? (s24 / o24).toFixed(2) : 0;
        });
        data2025 = days.map(d => {
            const s25 = avgs.salesAverages2025[d].length ? Math.round(avgs.salesAverages2025[d].reduce((a, b) => a + b, 0) / avgs.salesAverages2025[d].length) : 0;
            const o25 = avgs.ordersAverages2025[d].length ? Math.round(avgs.ordersAverages2025[d].reduce((a, b) => a + b, 0) / avgs.ordersAverages2025[d].length) : 0;
            return o25 > 0 ? (s25 / o25).toFixed(2) : 0;
        });
        subViewTitle = 'AOV';
    } else {  // 'sales' default
        data2024 = days.map(d => avgs.salesAverages2024[d].length ? Math.round(avgs.salesAverages2024[d].reduce((a, b) => a + b, 0) / avgs.salesAverages2024[d].length) : 0);
        data2025 = days.map(d => avgs.salesAverages2025[d].length ? Math.round(avgs.salesAverages2025[d].reduce((a, b) => a + b, 0) / avgs.salesAverages2025[d].length) : 0);
        subViewTitle = 'Sales';
    }
    labels = days;
    datasets = [
        {
            label: `${subViewTitle} 2024`,
            data: data2024,
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
        },
        {
            label: `${subViewTitle} 2025`,
            data: data2025,
            backgroundColor: 'rgba(255, 99, 132, 0.5)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 1
        }
    ];
    break;
case 'forecast-h2':
    // Grouped bar chart: MTD and ROM for 2024, Target, 2025
    const forecastData = calculateSalesData(store, month);
    labels = ['2024', 'Target', '2025'];
    datasets = [
        {
            label: 'MTD ($)',
            data: [forecastData.mtd2024, forecastData.mtdTarget, forecastData.mtd2025],
            backgroundColor: 'rgba(54, 162, 235, 0.8)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
        },
        {
            label: 'ROM ($)',
            data: [forecastData.rom2024, forecastData.romTarget, forecastData.rom2025],
            backgroundColor: 'rgba(255, 159, 64, 0.8)',
            borderColor: 'rgba(255, 159, 64, 1)',
            borderWidth: 1
        }
    ];
    chartType = 'bar';
    break;
        case 'scenarios-h2':
            // Bar chart: Scenario ROM values
            const scenarioData = calculateSalesData(store, month);
            
            const mtdGrowthPct = scenarioData.mtd2024 > 0 ? ((scenarioData.mtd2025 / scenarioData.mtd2024) - 1) * 100 : 0;
            labels = [
                `${month} 2024 Repeats`,
                `${month} at ${growthTarget}${growthType === 'dollar' ? 'K' : '%'} Growth`,
                `${month} at Current Rate ${formatPercent(mtdGrowthPct).replace('%', '')}%`
            ];
            datasets = [{
                label: 'ROM ($)',
                data: [scenarioData.rom2024, scenarioData.romTarget, scenarioData.rom2025],
                backgroundColor: 'rgba(75, 192, 192, 0.5)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }];
            break;
        case 'seven-day-h2':
            // Line chart: Predicted sales and orders next 7 days
            const days7 = window.predictionDates || [];
            if (days7.length === 0) return;
labels = days7.map(d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
const salesPred = days7.map((_, i) => {
    const el = document.getElementById(`pred-sales-${i}`);
    return el ? parseFloat(el.textContent.replace(/[^0-9.-]+/g, '')) || 0 : 0;
});
const ordersPred = days7.map((_, i) => {
    const el = document.getElementById(`pred-orders-${i}`);
    return parseInt(el ? el.textContent : '0') || 0;
});
datasets = [
    {
        type: 'bar',  // Line for Sales
        label: 'Predicted Sales ($)',
        data: salesPred,
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.1,
        fill: false,
        yAxisID: 'y'  // Left axis
    },
    {
        type: 'line',  // Bars for Orders
        label: 'Predicted Orders',
        data: ordersPred,
        backgroundColor: 'rgba(255, 99, 132, 0.6)',  // Solid for bars
        borderColor: 'rgba(255, 99, 132, 1)',
        borderWidth: 1,
        yAxisID: 'y1'  // Right axis
    }
];
            break;
case 'daycount-h2':
    // Bar chart: 2024 vs 2025 Day Counts (Weekdays/Weekends)
    const categories = ['Weekdays', 'Weekends'];
    let lastYearWeekdays = 0, lastYearWeekends = 0;
    let elapsedWeekdays = 0, elapsedWeekends = 0;
    let remainingWeekdays = 0, remainingWeekends = 0;
    let lastRecordedDate = null;
    // Extract from table logic
    netsalesData.forEach(row => {
        const date = new Date(row[2]);
        if (isNaN(date)) return;
        const rowMonth = date.toLocaleString('en-US', { month: 'long' });
        if (month && rowMonth !== month) return;
        const value = row[storeColumns[store]];
        if (!value || value.toString().trim() === '') return;
        const year = date.getFullYear();
        const dayIndex = date.getDay();
        if (year === 2024) {
            if (dayIndex >= 1 && dayIndex <= 5) lastYearWeekdays++;
            else lastYearWeekends++;
        } else if (year === 2025) {
            if (dayIndex >= 1 && dayIndex <= 5) elapsedWeekdays++;
            else elapsedWeekends++;
            if (!lastRecordedDate || date > lastRecordedDate) lastRecordedDate = date;
        }
    });
    // Calculate remaining for 2025
    if (month && !lastRecordedDate) {
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        const lastDayOfMonth = new Date(2025, monthIndex + 1, 0).getDate();
        for (let d = 1; d <= lastDayOfMonth; d++) {
            const date = new Date(2025, monthIndex, d);
            const dayIndex = date.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) remainingWeekdays++;
            else remainingWeekends++;
        }
    } else if (month && lastRecordedDate) {
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        const lastDayOfMonth = new Date(2025, monthIndex + 1, 0).getDate();
        for (let d = lastRecordedDate.getDate() + 1; d <= lastDayOfMonth; d++) {
            const date = new Date(2025, monthIndex, d);
            const dayIndex = date.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) remainingWeekdays++;
            else remainingWeekends++;
        }
    }
    const total2025Weekdays = elapsedWeekdays + remainingWeekdays;
    const total2025Weekends = elapsedWeekends + remainingWeekends;
    labels = categories;
    datasets = [
        {
            label: '2024 Counts',
            data: [lastYearWeekdays, lastYearWeekends],
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
        },
        {
            label: '2025 Projected Total',
            data: [total2025Weekdays, total2025Weekends],
            backgroundColor: 'rgba(255, 99, 132, 0.5)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 1
        }
    ];
    chartType = 'bar';
    break;
        default:
            document.getElementById('chart-container').style.display = 'none';
            return;
    }
    window.currentChart = new Chart(ctx, {
        type: chartType,
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `${sectionId.replace('-h2', ' ').replace(/\b\w/g, l => l.toUpperCase())} - Dynamic Chart`
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
  scales: {
    x: {
        beginAtZero: true
    },
    y: {  // Left axis (always for sales/bars)
        type: 'linear',
        display: true,
        position: 'left',
        beginAtZero: true,
        ...(sectionId === 'seven-day-h2' ? {
            title: {
                display: true,
                text: 'Net Sales ($)'
            }
        } : {})
    },
    ...(sectionId === 'seven-day-h2' ? {
        y1: {  // Right axis (Orders, only for seven-day)
            type: 'linear',
            display: true,
            position: 'right',
            beginAtZero: true,
            title: {
                display: true,
                text: 'Orders'
            },
            grid: {
                drawOnChartArea: false  // No overlapping grids
            }
        }
    } : {})
}
        }
    });
    console.log(`Chart created for ${sectionId}:`, window.currentChart);
    window.activeSection = sectionId;
    container.style.display = 'block';
}

/* -------------------------------------------------------------
   START – auto-select current month
   ------------------------------------------------------------- */
window.onload = () => {
    // Add click listeners for sections
    const sections = ['forecast-h2', 'scenarios-h2', 'seven-day-h2', 'metrics-h2', 'daycount-h2'];
sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('click', () => {
    console.log(`Section clicked: ${id} - About to call updateChartForSection`);
    updateChartForSection(id);
    console.log(`updateChartForSection returned for ${id}`);
});
    }
});
// Add change listeners for filters/toggles
const monthFilter = document.getElementById('month-filter');
if (monthFilter) monthFilter.addEventListener('change', () => {
    updateTables();
});
const storeFilter = document.getElementById('store-filter');
if (storeFilter) storeFilter.addEventListener('change', () => {
    updateTables();
});
const adjustedToggle = document.getElementById('adjusted-toggle');
if (adjustedToggle) adjustedToggle.addEventListener('change', () => {
    updateTables();
});
const growthTargetSel = document.getElementById('growth-target');
if (growthTargetSel) growthTargetSel.addEventListener('change', () => {
    updateGrowthTarget();
    updateTables();
});
// Add click listeners for metrics sub-headers
['sales', 'orders', 'aov'].forEach(view => {
    const header = document.getElementById(`${view}-header`);
    if (header) {
        header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    // Update active class (add underline or style)
    document.querySelectorAll('#metrics-table th[colspan="4"]').forEach(h => {
        h.style.textDecoration = 'none';
        h.style.color = '#333';
    });
    header.style.textDecoration = 'underline';
    header.style.color = '#3498db';
    // Set global and always refresh/show chart
    currentMetricsSubView = view;
    window.activeSection = 'metrics-h2';  // Force section active
    updateChartForSection('metrics-h2');
});
    }
});

    gapi.load('client', () => {
        gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS })
            .then(() => loadSheetsData())
            .then(refreshed => {
                if (refreshed) {
                    populateMonthDropdown();

                    // Auto-select current month if it's 2025
                    const now = new Date();
                    if (now.getFullYear() === 2025) {
                        const currentMonth = now.toLocaleString('en-US', { month: 'long' });
                        const monthSel = document.getElementById('month-filter');
                        if (monthSel && monthSel.querySelector(`option[value="${currentMonth}"]`)) {
                            monthSel.value = currentMonth;
                        }
                    }
                }
                updateTables();  // This triggers Next Day logic

            })
            .catch(err => {
                console.error('Init error:', err);
                setStatus('Init error');
            });
    });
};

/* -------------------------------------------------------------
   NEXT DAY TARGETED NET SALES – DYNAMIC SHARES
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   NEXT DAY TARGETED NET SALES – DYNAMIC + CUSTOM SOURCE STRING
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   NEXT DAY TARGETED NET SALES – PER STORE & MONTH
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   NEXT DAY TARGETED NET SALES – MAX OF CALC OR AVG
   ------------------------------------------------------------- */
function getNextDayTargetedNetSales(store, month, remaining$, netsalesData, nextDayDate) {
    if (!nextDayDate) return { value: 0, source: 'No next day' };

    const nextWeekday = nextDayDate.toLocaleString('en-US', { weekday: 'long' });
    const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
    const totalDays = new Date(2025, monthIndex + 1, 0).getDate();

    // Count remaining days of each weekday
    const remainingCount = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    for (let d = nextDayDate.getDate(); d <= totalDays; d++) {
        const date = new Date(2025, monthIndex, d);
        const dayName = date.toLocaleString('en-US', { weekday: 'long' });
        remainingCount[dayName]++;
    }

    const nextDayCount = remainingCount[nextWeekday];

    // Use 2025 if ≥7 days, else 2024
    let days2025 = 0;
    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (d.getFullYear() === 2025 && 
            d.toLocaleString('en-US', { month: 'long' }) === month) {
            const val = row[storeColumns[store]];
            if (val != null && val.toString().trim() !== '') {
                days2025++;
            }
        }
    });

    const use2025 = days2025 >= 7;
    const sourceYear = use2025 ? '2025' : '2024';

    // Calculate averages for THIS store and month
    const dayAverages = {};
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    days.forEach(d => dayAverages[d] = 0);

    let count = {};
    days.forEach(d => count[d] = 0);

    const lastDataDate = getLastDataDate(store, month);

    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (d.getFullYear() !== (use2025 ? 2025 : 2024) || 
            d.toLocaleString('en-US', { month: 'long' }) !== month) return;

        // Only include days that have occurred
        if (use2025 && lastDataDate && d > lastDataDate) return;

        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const cell = row[storeColumns[store]];
        const sales = (cell != null && cell.toString().trim() !== '') 
            ? parseFloat(cell.toString().replace(/[^0-9.-]+/g, '')) || 0 
            : 0;

        dayAverages[dayName] += sales;
        count[dayName]++;
    });

    let weeklyTotal = 0;
    days.forEach(d => {
        dayAverages[d] = count[d] > 0 ? dayAverages[d] / count[d] : 0;
        weeklyTotal += dayAverages[d];
    });

    const nextDayAvg = dayAverages[nextWeekday] || 0;

    // Total expected sales in remaining period
    let totalRemainingExpected = 0;
    days.forEach(d => {
        totalRemainingExpected += dayAverages[d] * remainingCount[d];
    });

    const nextDayContribution = nextDayAvg * 1;  // only 1 instance of next day
    const share = totalRemainingExpected > 0 ? nextDayContribution / totalRemainingExpected : 0;
    const calculatedTarget = remaining$ * share;

    // Final target = MAX(calculated, nextDayAvg)
    const target = Math.max(calculatedTarget, nextDayAvg);

    // Source string
    const sharePct = (share * 100).toFixed(1);
    const source = `MAX of Target ${formatNumber(remaining$)}<sub>ROM</sub> × ${sharePct}% <sub>Single ${nextWeekday} share</sub>
OR ${formatNumber(nextDayAvg)}<sub>${nextWeekday} avg</sub>`;

        // === Expected Customers – average from most recent 3 same days ===
     // === Expected Customers – average from most recent 3 same days ===
        // === Expected Customers – last 3 same weekdays before Next Day ===
    let recentOrders = [];

    ordersData.forEach(row => {
        const d = new Date(row[2]);
        if (d >= nextDayDate) return; // only before Next Day

        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        if (dayName !== nextWeekday) return;

        const orders = parseFloat(row[storeColumns[store]]) || 0;
        if (orders > 0) {
            recentOrders.push({ date: d, orders });
        }
    });

    // Sort by date descending, take last 3
    recentOrders.sort((a, b) => b.date - a.date);
    recentOrders = recentOrders.slice(0, 3);

    const expectedCustomers = recentOrders.length > 0 
        ? recentOrders.reduce((a, b) => a + b.orders, 0) / recentOrders.length 
        : 0;

    return {
        value: target,
        source: source,
        customers: expectedCustomers,
        recentCount: recentOrders.length,
        nextWeekday: nextWeekday,
        nextDateStr: nextDayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    };
}

/* -------------------------------------------------------------
   SUMMARY TABLE
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   SUMMARY TABLE
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   SUMMARY TABLE
   ------------------------------------------------------------- */
function updateSummaryTable(store, month) {
    const data = calculateSalesData(store, month);
    const tbody = document.getElementById('summary-table')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
    const totalDays = new Date(2025, monthIndex + 1, 0).getDate();
    

    // === Skip targets for past months ===
    const now = new Date();
    const monthEnd = new Date(2025, monthIndex + 1, 0); // last day of month
    const isPastMonth = now > monthEnd;

    // === Calculate growth values (needed for both paths) ===
    const mtdGrowth$ = data.mtd2025 - data.mtd2024;
    const mtdGrowthPct = data.mtd2024 > 0 ? ((data.mtd2025 / data.mtd2024) - 1) * 100 : 0;

    if (isPastMonth) {
        const rows = [
            [
                "Next Day",
                "Complete",
                '--'
            ],
            [
                "MTD Growth",
                `<span style="color: ${mtdGrowth$ >= 0 ? 'green' : 'red'};">
                    ${mtdGrowth$ >= 0 ? '⬆️' : '⬇️'} 
                    ${formatPercent(mtdGrowthPct)}, 
                    ${formatNumber(mtdGrowth$)}
                </span>`,
                `$${data.mtd2024.toLocaleString()}<sub><small>2024</small></sub> → $${data.mtd2025.toLocaleString()}<sub><small>2025</small></sub>`
            ]
        ];

      rows.forEach(([metric, value, source]) => {
    const tr = document.createElement('tr');
    if (metric === "Next Day") {
        tr.innerHTML = `
            <td onclick="updateChartForSummaryRow('next-day')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
            <td style="padding:3px; color:#666; font-size: small; font-style:italic;">${source}</td>
        `;
    } else if (metric === "MTD Growth") {
        tr.innerHTML = `
            <td onclick="updateChartForSummaryRow('mtd-growth')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
            <td style="padding:3px; color:#666; font-size: small; font-style:italic;">${source}</td>
        `;
    } else if (metric === "Remaining to Target ($)") {
    tr.innerHTML = `
        <td onclick="updateChartForSummaryRow('remaining-target')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
        <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
        <td style="padding:3px; color:#666; font-size: small; font-style:italic;">${source}</td>
    `;
    
    } else {
        tr.innerHTML = `
            <td style="padding:3px;">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
            <td style="padding:3px; color:#666; font-size: small; font-style:italic;">${source}</td>
        `;
    }
    tbody.appendChild(tr);
});
        return;
    }

         // === Next Day – first blank day in 2025 ===
    let nextDayLabel = "Next Day (No data yet)";

    const lastDataDate = getLastDataDate(store, month);
    let firstBlankDay;

    if (lastDataDate === null || lastDataDate < new Date(2025, monthIndex, 1)) {
        firstBlankDay = new Date(2025, monthIndex, 1); // first day of selected month
    } else {
        firstBlankDay = new Date(lastDataDate);
        firstBlankDay.setDate(firstBlankDay.getDate() + 1);
    }

    if (firstBlankDay.getDate() > totalDays) {
        nextDayLabel = "Next Day: Complete";
    } else {
        const dayName = firstBlankDay.toLocaleString('en-US', { weekday: 'long' });
        const monthName = firstBlankDay.toLocaleString('en-US', { month: 'long' });
        nextDayLabel = `${dayName}, ${monthName} ${firstBlankDay.getDate()}`;
    }

    const overallTarget = data.mtdTarget + data.romTarget;
    const remaining$ = overallTarget - data.mtd2025;
    const growthNeededPct = data.rom2024 > 0 ? ((remaining$ / data.rom2024) - 1) * 100 : 0;

    const growthAmount = growthType === 'percent' 
        ? (data.mtd2024 + data.rom2024) * (growthTarget / 100) 
        : growthTarget * 1000;

    const nextDayTarget = getNextDayTargetedNetSales(store, month, remaining$, netsalesData, firstBlankDay);

        const rows = [
        [
            "Growth",
            `<span style="color: ${mtdGrowth$ >= 0 ? 'green' : 'red'};">
                ${mtdGrowth$ >= 0 ? '⬆️' : '⬇️'}
                ${formatPercent(mtdGrowthPct)},
                ${formatNumber(mtdGrowth$)}
            </span>`,
        ],
        [
            "Target",
            `${formatNumber(overallTarget)}`,
        ],
        [
            "Remaining",
            remaining$ <= 0
                ? `<span style="color: green; font-weight: bold;">✓ Target Met</span>`
                : `<span>
                       ${formatNumber(remaining$)}
                   </span>`,
        ],
        [
            "ROM Target",
            remaining$ <= 0
                ? `<span style="color: green; font-weight: bold;">✓ Target Met</span>`
                : `<span style="color: ${growthNeededPct >= 0 ? 'green' : 'red'};">
                       ${formatPercent(growthNeededPct)}
                   </span>`,
        ],
        [
            "Target Sales",
            `<span style="color: ${nextDayTarget.value >= 0 ? 'green' : 'red'};">
                ${formatNumber(nextDayTarget.value)}
            </span>`,
        ],
        [
            "Expected Orders",
            `<span>
                ${Math.round(nextDayTarget.customers)}
            </span>`,
        ],
        [
            "AOV Target",
            `<span>
                $${(nextDayTarget.value / nextDayTarget.customers).toFixed(2)}
            </span>`,
        ],
        // === NEW ROWS ===
        [
            "Staff Hours",
            totalStaffingHours > 0 ? totalStaffingHours.toFixed(1) + "h" : "—"
        ],
               [
            "Forecast Sales",
            formatNumber(nextDayPredictedSales)
        ],
        [
            "Per Staff Hour",
            totalStaffingHours > 0 
                ? "$" + Math.round(nextDayPredictedSales / totalStaffingHours)
                : "—"
        ]
    ];

   rows.forEach(([metric, value, source]) => {
    const tr = document.createElement('tr');
    if (metric === "Next Day") {
        tr.innerHTML = `
            <td onclick="updateChartForSummaryRow('next-day')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
        `;
    } else if (metric === "MTD Growth") {
        tr.innerHTML = `
            <td onclick="updateChartForSummaryRow('mtd-growth')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
        `;
        
    } 
    
    else if (metric === "Remaining to Target ($)") {
    tr.innerHTML = `
        <td onclick="updateChartForSummaryRow('remaining-target')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
        <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
    `;
    
    }
    
    else {
        tr.innerHTML = `
            <td style="padding:3px;">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
        `;
    }
    tbody.appendChild(tr);
});

    


    
}

function updateChartForSummaryRow(rowKey) {
    const store = document.getElementById('store-filter').value || 'CAFE';
    const month = document.getElementById('month-filter').value || '';
    const container = document.getElementById('chart-container');
    let canvas = document.getElementById('dynamic-chart');
    if (canvas) canvas.style.display = 'none';
if (!container || (rowKey !== 'next-day' && rowKey !== 'mtd-growth' && rowKey !== 'remaining-target')) return;    // Hide canvas, show HTML mode
    if (canvas) canvas.style.display = 'none';
    container.style.display = 'block';
    container.innerHTML = ''; // Clear old content when switching views
    if (rowKey === 'next-day') {
        // Get month details
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        if (monthIndex === -1) {
            container.innerHTML = '<p style="text-align:center; color:#666;">Select a month for calendar view.</p>';
            return;
        }
        const totalDays = new Date(2025, monthIndex + 1, 0).getDate();
        const isAdjusted = document.getElementById('adjusted-toggle').checked || false;
        const currentDate = new Date('2025-11-08'); // Fixed for demo
        const isPastMonth = currentDate > new Date(2025, monthIndex + 1, 0);
        const lastDataDate = getLastDataDate(store, month);
        const elapsedDay2025 = lastDataDate ? lastDataDate.getDate() : (monthIndex < currentDate.getMonth() ? totalDays : Math.min(currentDate.getDate(), totalDays));
        const nextDay2025 = new Date(2025, monthIndex, elapsedDay2025 + 1);
        const isMonthComplete = nextDay2025.getDate() > totalDays || isPastMonth; // Add isPastMonth to complete status
        // Elapsed for 2024 (with shift)
        const shift = isAdjusted ? 1 : 0;
        const elapsedStart2024 = 1 + shift;
        const elapsedEnd2024 = elapsedDay2025 + shift;
        // Build calendars
        let html = `
            <div style="text-align: center; margin: 10px 0;">
                <h3 style="color: #34495e; margin: 0;">Month Comparison: ${month} 2024 vs. 2025 (Elapsed Days Highlighted)</h3>
                <p style="color: #666; font-size: 0.9em;">Green: Elapsed | Outlined: Next Day | Bold: Has Data</p>
            </div>
            <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">
        `;
        [2024, 2025].forEach(year => {
            const is2025 = year === 2025;
            let totalDaysEffective = totalDays;
            let adjMonthIndex = -1;
            let adjYear = year;
            let adjDate = null;
            if (!is2025 && isAdjusted) {
                totalDaysEffective = totalDays + 1;
                adjMonthIndex = (monthIndex + 1) % 12;
                adjYear = monthIndex === 11 ? year + 1 : year;
                adjDate = new Date(adjYear, adjMonthIndex, 1);
            }
            // Year-specific weeks calculation
            const firstDay = new Date(year, monthIndex, 1).getDay();
            const weeks = Math.ceil((totalDaysEffective + firstDay) / 7);
            // Precompute data per day (sales $, orders #) - for this year only
            const dayDataCurrent = {};
            const loopDays = is2025 ? totalDays : totalDaysEffective;
            for (let d = 1; d <= loopDays; d++) {
                dayDataCurrent[d] = { sales: 0, orders: 0 };
                // Fetch sales/orders for this year
                let fetchDate = new Date(year, monthIndex, d);
                if (!is2025 && isAdjusted && d > totalDays) {
                    fetchDate = adjDate;
                }
                netsalesData.forEach(row => {
                    const rowDate = new Date(row[2]);
                    if (rowDate.getTime() === fetchDate.getTime()) {
                        const salesVal = row[storeColumns[store]];
                        dayDataCurrent[d].sales = parseFloat(salesVal?.toString().replace(/[^0-9.-]+/g, '') || 0);
                        const orderRow = ordersData.find(o => new Date(o[2]).getTime() === fetchDate.getTime());
                        dayDataCurrent[d].orders = parseFloat(orderRow?.[storeColumns[store]] || 0);
                    }
                });
            }
            const dayData = dayDataCurrent;
            const elapsedStart = is2025 ? 1 : elapsedStart2024;
            const elapsedEnd = is2025 ? elapsedDay2025 : Math.min(elapsedEnd2024, totalDaysEffective);
            html += `
                <div style="min-width: 200px;">
                    <h4 style="text-align: center; color: #2c3e50; margin: 5px 0;">${year} ${month}</h4>
                    <table style="border-collapse: collapse; margin: 0 auto; font-size: 0.8em;">
                        <thead>
                            <tr style="background: #e0e0e0;">
                                ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<th style="border: 1px solid #ddd; padding: 4px;">${day}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
            `;
            let currentWeek = firstDay; // Reuse firstDay for padding count
            let day = 1;
            for (let w = 0; w < weeks; w++) {
                html += '<tr>';
                for (let wd = 0; wd < 7; wd++) { // 0=Sun, 6=Sat
                    if (currentWeek > 0) {
                        html += '<td style="border: 1px solid #ddd; padding: 2px; height: 40px; vertical-align: top; background: #f9f9f9;"></td>';
                        currentWeek--;
                    } else if (day > totalDaysEffective) {
                        html += '<td style="border: 1px solid #ddd; padding: 2px; height: 40px; vertical-align: top; background: #f0f0f0;"></td>';
                    } else {
                        const inElapsed = day >= elapsedStart && day <= elapsedEnd;
                        let cellStyle = 'border: 1px solid #ddd; padding: 2px; height: 40px; vertical-align: top;';
                        if (inElapsed) {
                            cellStyle += ' background-color: #d4edda;'; // Light green
                        } else if (day > elapsedEnd) {
                            cellStyle += ' background-color: #f8f9fa;'; // Light gray
                        }
                        // Next Day (2025 only, skip for past months) - outline here
                        if (is2025 && !isPastMonth && day === nextDay2025.getDate() && !isMonthComplete) {
                            cellStyle += ' border: 2px solid #28a745 !important; background-color: #fff3cd !important;'; // Yellow bg + Green outline
                        }
                        let dayLabel = day.toString();
                        let titleDate = `${month} ${day}, ${year}`;
                        if (!is2025 && isAdjusted && day > totalDays) {
                            const adjMonthShort = adjDate.toLocaleDateString('en-US', { month: 'short' });
                            dayLabel = `${adjMonthShort} 1`;
                            titleDate = `${adjMonthShort} 1, ${adjYear}`;
                        }
                        const salesK = (dayData[day].sales / 1000).toFixed(1);
                        const orders = dayData[day].orders;
                        const hasData = dayData[day].sales > 0 || orders > 0;
                        let content = `<div style="font-weight: ${hasData ? 'bold' : 'normal'};">${dayLabel}</div>`;
                        if (hasData) {
                            content += `<div style="font-size: 0.7em; line-height: 1.1;">
                                <small>$${salesK}K</small><br>
                                <small>${orders || ''}</small>
                            </div>`;
                        }
                        html += `<td style="${cellStyle}" title="${titleDate}: Sales $${dayData[day].sales.toLocaleString()} | Orders: ${orders}">${content}</td>`;
                        day++;
                    }
                }
                html += '</tr>';
            }
            html += '</tbody></table></div>';
        });
        html += '</div>';
        container.innerHTML = html;
        window.activeView = 'next-day';
        return;
    }
    if (rowKey === 'mtd-growth') {
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        if (monthIndex === -1) {
            container.innerHTML = '<p style="text-align:center; color:#666;">Select a month for MTD Growth chart.</p>';
            window.activeView = 'mtd-growth';
            return;
        }
        container.innerHTML = ''; // Clear any old content
        const totalDays = new Date(2025, monthIndex + 1, 0).getDate();
        const shift = document.getElementById('adjusted-toggle')?.checked ? 1 : 0;
        const idx = storeColumns[store];

        // Collect and sort daily sales for 2024 and 2025
        const sales2024 = {};
        const sales2025 = {};
        netsalesData.forEach(row => {
            const d = new Date(row[2]);
            if (isNaN(d) || d.toLocaleString('en-US', { month: 'long' }) !== month) return;
            const day = d.getDate();
            const sales = parseFloat(row[idx]?.toString().replace(/[^0-9.-]+/g, '') || 0);
            if (sales === 0) return;
            const year = d.getFullYear();
            if (year === 2024) {
                // Apply shift for 2024
                const adjDay = day - shift;
                if (adjDay >= 1 && adjDay <= totalDays) {
                    sales2024[adjDay] = (sales2024[adjDay] || 0) + sales;
                }
            } else if (year === 2025) {
                sales2025[day] = (sales2025[day] || 0) + sales; // 2025 no shift
            }
        });

        // Compute cumulatives
        const cum2024 = [];
        const cum2025 = [];
        let running2024 = 0;
        let running2025 = 0;
        for (let day = 1; day <= totalDays; day++) {
            running2024 += sales2024[day] || 0;
            running2025 += sales2025[day] || 0;
            cum2024.push(running2024);
            cum2025.push(running2025);
        }

// Calculate elapsed days for cutoff (use 2025 last data date or current if no data)
const lastDataDate = getLastDataDate(store, month);
const elapsedDays = lastDataDate ? lastDataDate.getDate() : new Date().getDate();
const cutoffDay = Math.min(elapsedDays, totalDays);

// Slice arrays to cutoff
const labels = Array.from({length: cutoffDay}, (_, i) => i + 1);
const slicedCum2024 = cum2024.slice(0, cutoffDay);
const slicedCum2025 = cum2025.slice(0, cutoffDay);



        // Create line chart
        let chartCanvas = document.getElementById('dynamic-chart');
        if (!chartCanvas) {
            chartCanvas = document.createElement('canvas');
            chartCanvas.id = 'dynamic-chart';
            chartCanvas.width = 400;
            chartCanvas.height = 300;
            container.appendChild(chartCanvas);
        }
        if (window.currentChart) window.currentChart.destroy();
        const ctx = chartCanvas.getContext('2d');
        window.currentChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Cumulative 2024',
                        data: slicedCum2024,
                        borderColor: 'rgba(54, 162, 235, 1)',
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        tension: 0.1,
                        fill: false
                    },
                    {
                        label: 'Cumulative 2025',
                        data: slicedCum2025,
                        borderColor: 'rgba(255, 99, 132, 1)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        tension: 0.1,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `MTD Cumulative Sales: ${month} ${store}`
                    },
                    legend: { display: true, position: 'top' }
                },
                scales: {
                    x: { title: { display: true, text: 'Day of Month' } },
                    y: { 
                        beginAtZero: true,
                        title: { display: true, text: 'Cumulative Net Sales ($)' }
                    }
                }
            }
        });

        chartCanvas.style.display = 'block';
        container.style.display = 'block';
        window.activeView = 'mtd-growth';
        return;
    }
if (rowKey === 'remaining-target') {
    container.innerHTML = ''; // Clear any old content
    const store = document.getElementById('store-filter').value || 'CAFE';
    const month = document.getElementById('month-filter').value || '';
    const data = calculateSalesData(store, month);
    const overallTarget = data.mtdTarget + data.romTarget;
    const remainingToTarget = overallTarget - data.mtd2025;
    const total2024 = data.mtd2024 + data.rom2024;
    const labels = ['2024 Full Month', '2025 MTD', 'Remaining to Target', '2025 Target'];
    const remainingColor = remainingToTarget > 0 ? 'rgba(255, 206, 86, 0.8)' : (remainingToTarget < 0 ? 'rgba(255, 99, 132, 0.8)' : 'rgba(150, 150, 150, 0.8)');
    const datasets = [
        {
            label: '2024 Full Month',
            data: [total2024, null, null, null],
            backgroundColor: 'rgba(54, 162, 235, 0.8)'
        },
        {
            label: '2025 MTD',
            data: [null, data.mtd2025, null, null],
            backgroundColor: 'rgba(75, 192, 192, 0.8)'
        },
        {
            label: 'Remaining to Target',
            data: [null, null, remainingToTarget !== 0 ? [data.mtd2025, overallTarget] : null, null],
            backgroundColor: remainingColor
        },
        {
            label: '2025 Target',
            data: [null, null, null, overallTarget],
            backgroundColor: 'rgba(153, 102, 255, 0.8)'
        }
    ];

    // Create bar chart with floating for Remaining
    let chartCanvas = document.getElementById('dynamic-chart');
    if (!chartCanvas) {
        chartCanvas = document.createElement('canvas');
        chartCanvas.id = 'dynamic-chart';
        chartCanvas.width = 400;
        chartCanvas.height = 300;
        container.appendChild(chartCanvas);
    }
    if (window.currentChart) window.currentChart.destroy();
    const ctx = chartCanvas.getContext('2d');
    window.currentChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `Target Waterfall: ${month} ${store}`
                },
                legend: { display: true, position: 'top' },
                tooltip: {
                    callbacks: {
label: function(context) {
    let label = context.dataset.label || '';
    if (label) {
        label += ': ';
    }
    if (context.parsed.y !== null) {
        if (context.dataset.label === 'Remaining to Target') {
            label += formatNumber(remainingToTarget);  // Direct diff value
        } else {
            label += formatNumber(context.parsed.y);
        }
    }
    return label;
}                    }
                }
            },
            scales: {
                x: { stacked: false },
                y: { 
                    beginAtZero: true,
                    stacked: true,
                    title: { display: true, text: 'Net Sales ($)' }
                }
            }
        }
    });
    chartCanvas.style.display = 'block';
    container.style.display = 'block';
    window.activeView = 'remaining-target';
    return;
}
 


// For other rows, extend similarly (e.g., if (rowKey === 'mtd-growth') { ... })
}

// ====================== TODAY'S SCHEDULE – USING GAPI (WORKS EXACTLY LIKE THE REST OF YOUR DASHBOARD) ======================
const scheduleTabs = {
    CAFE: "Schedule-CAFE",
    FEELLOVE: "Schedule-FEELLOVE",
    SNOW: "Schedule-SNOW",
    ZION: "Schedule-ZION"
};

// Store-specific opening hours (24-hour format, strings are fine)
const storeHours = {
    CAFE:     { open: "07:00", close: "15:00" },   // 7am – 3pm daily
    FEELLOVE: { 
        weekday: { open: "06:00", close: "19:00" },  // Mon–Fri 6am – 7pm
        weekend: { open: "07:00", close: "16:00" }   // Sat–Sun 7am – 4pm
    },
    SNOW:     { open: "06:00", close: "17:00" },   // 6am – 5pm daily
    ZION:     { open: "06:00", close: "17:00" }    // 6am – 5pm daily
};

function formatMT(timeStr) {
    let [h, m] = timeStr.split(":").map(Number);
    h = (h - 7 + 24) % 24;
    return `${h}:${m.toString().padStart(2,"0")}`;
}

async function loadTodaySchedule(store) {
    const storeKey = store || 'CAFE';

    // === Determine the date for the schedule (day after last sales) ===
    const lastSalesDate = getLastDataDate(storeKey, '');   // your existing function
    let scheduleDate = new Date();
    if (lastSalesDate) {
        scheduleDate = new Date(lastSalesDate);
        scheduleDate.setDate(scheduleDate.getDate() + 1);  // day after last sales
    } else {
        scheduleDate.setDate(scheduleDate.getDate() + 1);  // tomorrow if no data
    }

    // === today for weekend check (real today in MT) ===
    const today = new Date();   // ← this line was missing – fixes weekend detection

    const todayShort = scheduleDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    document.getElementById("schedule-date").textContent = 
        " – " + scheduleDate.toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const tab = scheduleTabs[storeKey] || "Schedule-SNOW";

    // === Store-specific open/close today ===
    let openHour, closeHour, hoursText;
    if (storeKey === "CAFE") {
        openHour = 7; closeHour = 15; hoursText = "Open 7am – 3pm";
    } else if (storeKey === "FEELLOVE") {
const isWeekend = scheduleDate.getDay() === 0 || scheduleDate.getDay() === 6;  // Sun=0, Sat=6
if (isWeekend) { openHour = 7; closeHour = 16; hoursText = "Open 7am – 4pm (Weekend)"; }
        else { openHour = 6; closeHour = 19; hoursText = "Open 6am – 7pm (Weekday)"; }
    } else { // SNOW & ZION
        openHour = 6; closeHour = 17; hoursText = "Open 6am – 5pm";
    }

    const visibleStart = openHour - 1;
    const visibleEnd = closeHour + 1;
    const visibleHours = visibleEnd - visibleStart;

    try {
        const resp = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!A:E`
        });
        const rows = resp.result.values || [];
        const shifts = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 5) continue;
            if (row[0] === todayShort && row[2]) {
                shifts.push({
                    employee: (row[2] + "").replace(/ \(Shift a.*\)/, '').trim(),
                    start: row[3],
                    end: row[4]
                });
            }
        }

        // === Header with dynamic columns ===
        let html = `<div class="gantt-header" style="grid-template-columns: 150px repeat(${visibleHours}, 1fr);">
            <div><small style="font-weight:normal;color:#ccc;">${hoursText}</small></div>`;
        for (let i = 0; i < visibleHours; i++) {
            const hour = (visibleStart + i + 24) % 24;
            const label = hour < 10 ? ` ${hour}:00` : `${hour}:00`;
            const isOpen  = hour === openHour;
            const isClose = hour === closeHour;
            html += `<div class="hour"${isOpen || isClose ? ' style="position:relative;"' : ''}>
                        <span>${label}</span>`;
            if (isOpen || isClose) html += `<div style="position:absolute;top:10px;left:0;right:0;border-right:4px solid #27ae60;"></div>`;
            html += `</div>`;
        }
        html += `</div>`;

        if (shifts.length === 0) {
            html += `<p style="padding:20px;text-align:center;color:#777;">No shifts scheduled today</p>`;
        } else {
            shifts.sort((a, b) => a.start.localeCompare(b.start));
            shifts.forEach(shift => {
                const [sh, sm] = shift.start.split(":").map(Number);
                const [eh, em] = shift.end.split(":").map(Number);
                const startDecimal = (sh - 7 + sm/60 + 24) % 24;
                const endDecimal   = (eh - 7 + em/60 + 24) % 24;
                let left  = ((startDecimal - visibleStart + 24) % 24) / visibleHours * 100;
                let width = ((endDecimal - startDecimal + 24) % 24) / visibleHours * 100;
                if (left < 0) { left = 0; width = 100 + width; }

                html += `<div class="employee-row">
                    <div class="employee-name">${shift.employee}</div>
                    <div class="timeline">
                        <div class="shift-bar" style="left:${left}%; width:${width}%;">${formatMT(shift.start)} – ${formatMT(shift.end)}</div>
                    </div>
                </div>`;
            });
        }

        // === Calculate total staffing hours ===
        let totalHours = 0;
        shifts.forEach(shift => {
            const [startH, startM] = shift.start.split(":").map(Number);
            const [endH, endM] = shift.end.split(":").map(Number);
            let hours = endH - startH + (endM - startM) / 60;
            if (hours < 0) hours += 24; // handle overnight shifts
            totalHours += hours;
        });
        const totalHoursDisplay = totalHours.toFixed(1);
        totalStaffingHours = parseFloat(totalHoursDisplay);   // make it global

        // Add total hours below the schedule
        html += `<div style="margin-top:15px; padding:10px; background:#f0f8ff; border-radius:8px; font-weight:bold; font-size:1.1em;">
            Total Staffing Hours: ${totalHoursDisplay}h
        </div>`;



        document.getElementById("gantt-chart").innerHTML = html;
        document.getElementById("schedule-container").style.display = "block";
    } catch (err) {
        console.error("Schedule error:", err);
        document.getElementById("gantt-chart").innerHTML = "<p style='color:red;padding:20px;'>Failed to load schedule</p>";
        document.getElementById("schedule-container").style.display = "block";
    }
}

// Collapsible
document.getElementById("schedule-h2").addEventListener("click", () => {
    const c = document.getElementById("schedule-container");
    c.style.display = c.style.display === "block" ? "none" : "block";
});

// Reload schedule when store changes
document.getElementById("store-filter").addEventListener("change", () => {
    loadTodaySchedule(document.getElementById("store-filter").value);
});

function printDashboard() {
    const printWin = window.open('', '_blank', 'width=1200,height=800');

    const storeName = document.getElementById('store-filter').options[document.getElementById('store-filter').selectedIndex].text;
    const scheduleDate = document.getElementById('schedule-date').textContent;

    const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${storeName} – ${scheduleDate}</title>
            <style>
                @page { size: landscape; margin: 0.3in; }
                body { font-family: Arial, sans-serif; padding: 20px; background: white; color: black !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                h1 { text-align: center; color: #2c3e50; font-size: 28px; margin-bottom: 20px; }
                h2 { color: #34495e; font-size: 22px; margin: 25px 0 10px; }
                .row { display: flex; gap: 30px; margin-bottom: 30px; page-break-inside: avoid; }
                .col { flex: 1; }
                table { width: 100%; border-collapse: collapse; font-size: 14px; }
                th, td { border: 1px solid #333; padding: 8px; text-align: center; }
                th { background: #e0e0e0; }
                textarea { width: 100%; height: 400px; padding: 15px; font-size: 16px; border: 2px solid #333; border-radius: 8px; background: white; }
                .gantt-header { display: grid; grid-template-columns: 150px repeat(13, 1fr); background: #34495e; color: white; }
                .employee-row { display: grid; grid-template-columns: 150px 1fr; border-bottom: 1px solid #ddd; }
                .timeline { position: relative; height: 50px; background: #f8f9f9; }
                .shift-bar { position: absolute; top: 8px; height: 34px; background: #3498db; color: white; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>${storeName} – ${scheduleDate}</h1>
            <div class="row">
                <div class="col">
                    ${document.querySelector('#schedule-container').innerHTML}
                </div>
                <div class="col">
                    ${document.querySelector('#summary-table').outerHTML}
                </div>
            </div>
            <h2>Notes</h2>
            <textarea readonly>${document.getElementById('staff-notes-text')?.value || ''}</textarea>
        </body>
        </html>
    `;

    printWin.document.body.innerHTML = printHTML;
    printWin.focus();
    setTimeout(() => {
        printWin.print();
    }, 600);
}



// Run after main data is loaded (hook into your existing flow)
const originalUpdateTables = updateTables;
updateTables = function () {
    originalUpdateTables.apply(this, arguments);
    loadTodaySchedule(document.getElementById("store-filter").value);
};
