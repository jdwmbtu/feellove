const API_KEY = 'AIzaSyAbqqoWEYouY2nlLojZIXR1MFo7C0s-gQY';
const SPREADSHEET_ID = '1whPL4X-I815XVKbeFDxEHbhHbddUtb1XwsSE7MUaWYo';
const DISCOVERY_DOCS = ['https://sheets.googleapis.com/$discovery/rest?version=v4'];
const CURRENT_DATE = new Date();
const storeColumns = { CAFE: 3, FEELLOVE: 4, SNOW: 5, ZION: 6 };

let netsalesData = null;
let ordersData = null;
let growthTarget = 10;
let growthType = 'percent';
let isAdjusted = true;
let lastModifiedTime = null;

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
            console.log('Sheet unchanged – using cache');
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
        console.log('Fresh data loaded – modified:', lastModifiedTime);

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

    console.log(`Growth target: ${growthTarget} ${growthType === 'dollar' ? '($K)' : '(%)'} — selected: "${text}"`);
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
   7-DAY PREDICTION TABLE – HORIZONTAL (NEXT 7 DAYS, ANY MONTH)
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
    let headerHTML = '<tr><th></th>';
    days.forEach(d => {
        const dayName = d.toLocaleString('en-US', { weekday: 'short' });
        const dayNum = d.getDate();
        const monthName = d.toLocaleString('en-US', { month: 'short' });
        headerHTML += `<th style="text-align:center;">${dayName}<br>${monthName} ${dayNum}</th>`;
    });
    headerHTML += '</tr>';
    tbody.innerHTML += headerHTML;

    // Sales row
    let salesRow = '<tr><td style="font-weight:bold; text-align:right;">Net Sales</td>';
    days.forEach((d, i) => {
        salesRow += `<td id="pred-sales-${i}" style="text-align:right;">—</td>`;
    });
    salesRow += '</tr>';
    tbody.innerHTML += salesRow;

    // Orders row
    let ordersRow = '<tr><td style="font-weight:bold; text-align:right;">Orders</td>';
    days.forEach((d, i) => {
        ordersRow += `<td id="pred-orders-${i}" style="text-align:right;">—</td>`;
    });
    ordersRow += '</tr>';
    tbody.innerHTML += ordersRow;

    // Store dates for algo
    window.predictionDates = days;

    // === PREDICT ORDERS ===
    const dayAverages = {};
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    daysOfWeek.forEach(d => dayAverages[d] = { past3: [], lastYear: 0 });

    // Last 3 same weekdays (2025 or 2024)
    ordersData.forEach(row => {
        const d = new Date(row[2]);
        if (d >= startDate) return;

        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const orders = parseFloat(row[storeColumns[store]]) || 0;
        if (orders > 0) {
            dayAverages[dayName].past3.push(orders);
        }
    });

    // Find closest week in 2024
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
        const orders = row ? parseFloat(row[storeColumns[store]]) || 0 : 0;
        lastYearWeek.push(orders);
    }

    const lastYearWeekAvg = lastYearWeek.length > 0 ? lastYearWeek.reduce((a, b) => a + b, 0) / lastYearWeek.length : 1;

    // Predict each day
    days.forEach((d, i) => {
        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const past3 = dayAverages[dayName].past3.slice(-3);
        const avgPast3 = past3.length > 0 ? past3.reduce((a, b) => a + b, 0) / past3.length : 0;

        const lastYearDay = lastYearWeek[i] || avgPast3;
        const shape = lastYearWeekAvg > 0 ? lastYearDay / lastYearWeekAvg : 1;
        const predicted = Math.round(avgPast3 * shape);

        document.getElementById(`pred-orders-${i}`).textContent = predicted;
    });

    // === PREDICT NET SALES USING DAILY AOV FROM METRICS TABLE ===
    const avgs = calculateAverages(store, month);
    const dayAOV = {};

    // Reuse daysOfWeek from Orders section above
    // Build daily AOV map (2025 if available, else 2024)
    daysOfWeek.forEach(dayName => {
        const o25 = avgs.ordersAverages2025[dayName].length ? Math.round(avgs.ordersAverages2025[dayName].reduce((a,b)=>a+b,0)/avgs.ordersAverages2025[dayName].length) : 0;
        const s25 = avgs.salesAverages2025[dayName].length ? Math.round(avgs.salesAverages2025[dayName].reduce((a,b)=>a+b,0)/avgs.salesAverages2025[dayName].length) : 0;
        const o24 = avgs.ordersAverages2024[dayName].length ? Math.round(avgs.ordersAverages2024[dayName].reduce((a,b)=>a+b,0)/avgs.ordersAverages2024[dayName].length) : 0;
        const s24 = avgs.salesAverages2024[dayName].length ? Math.round(avgs.salesAverages2024[dayName].reduce((a,b)=>a+b,0)/avgs.salesAverages2024[dayName].length) : 0;

        const aov25 = o25 > 0 ? s25 / o25 : 0;
        const aov24 = o24 > 0 ? s24 / o24 : 0;

        dayAOV[dayName] = o25 > 0 ? aov25 : aov24;
    });

    // Predict Net Sales using daily AOV
    days.forEach((d, i) => {
        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const aov = dayAOV[dayName] || 0;
        const predictedOrders = parseInt(document.getElementById(`pred-orders-${i}`).textContent) || 0;
        const predictedSales = Math.round(predictedOrders * aov);

        console.log(`Day ${i} (${dayName}):`);
        console.log(`  Daily AOV from Metrics: ${formatNumber(aov, true)}`);
        console.log(`  Predicted Orders: ${predictedOrders}`);
        console.log(`  Predicted Sales: ${formatNumber(predictedSales)}`);

        document.getElementById(`pred-sales-${i}`).textContent = formatNumber(predictedSales);
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

/* -------------------------------------------------------------
   DYNAMIC CHART UPDATE
   ------------------------------------------------------------- */
function updateChartForSection(sectionId) {
    const store = document.getElementById('store-filter').value || 'CAFE';
    const month = document.getElementById('month-filter').value || '';
    const canvas = document.getElementById('dynamic-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Destroy previous chart
    if (window.currentChart) {
        window.currentChart.destroy();
    }

    let chartType = 'bar';
    let labels = [];
    let datasets = [];

    switch (sectionId) {
        case 'metrics-h2':
            // Bar chart: Sales 2024 vs 2025 by day of week
            const avgs = calculateAverages(store, month);
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            const sales2024 = days.map(d => avgs.salesAverages2024[d].length ? Math.round(avgs.salesAverages2024[d].reduce((a, b) => a + b, 0) / avgs.salesAverages2024[d].length) : 0);
            const sales2025 = days.map(d => avgs.salesAverages2025[d].length ? Math.round(avgs.salesAverages2025[d].reduce((a, b) => a + b, 0) / avgs.salesAverages2025[d].length) : 0);
            labels = days;
            datasets = [
                {
                    label: 'Sales 2024',
                    data: sales2024,
                    backgroundColor: 'rgba(54, 162, 235, 0.5)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Sales 2025',
                    data: sales2025,
                    backgroundColor: 'rgba(255, 99, 132, 0.5)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderWidth: 1
                }
            ];
            break;

        case 'forecast-h2':
            // Doughnut chart: MTD vs ROM 2025
            const forecastData = calculateSalesData(store, month);
            labels = ['MTD 2025', 'ROM Forecast'];
            datasets = [{
                data: [forecastData.mtd2025, forecastData.rom2025],
                backgroundColor: ['rgba(255, 99, 132, 0.5)', 'rgba(54, 162, 235, 0.5)'],
                borderColor: ['rgba(255, 99, 132, 1)', 'rgba(54, 162, 235, 1)'],
                borderWidth: 1
            }];
            chartType = 'doughnut';
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
                    label: 'Predicted Sales ($)',
                    data: salesPred,
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.1,
                    fill: false
                },
                {
                    label: 'Predicted Orders',
                    data: ordersPred,
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    tension: 0.1,
                    fill: false
                }
            ];
            chartType = 'line';
            break;

        case 'daycount-h2':
            // Pie chart: Weekdays vs Weekends (2025 Remaining)
            const daycountData = updateDayCountTable(store, month); // Note: This function populates table, but we can extract logic
            // For simplicity, hardcode based on table logic (you can extract variables if needed)
            const categories = ['Weekdays Remaining', 'Weekends Remaining'];
            const remainingWeekdays = 0; // Placeholder - extract from updateDayCountTable logic
            const remainingWeekends = 0; // Placeholder
            labels = categories;
            datasets = [{
                data: [remainingWeekdays, remainingWeekends],
                backgroundColor: ['rgba(54, 162, 235, 0.5)', 'rgba(255, 206, 86, 0.5)'],
                borderColor: ['rgba(54, 162, 235, 1)', 'rgba(255, 206, 86, 1)'],
                borderWidth: 1
            }];
            chartType = 'pie';
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
            scales: chartType === 'bar' || chartType === 'line' ? {
                y: {
                    beginAtZero: true
                }
            } : undefined
        }
    });

    document.getElementById('chart-container').style.display = 'block';
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
            el.addEventListener('click', () => updateChartForSection(id));
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
            "Next Day",
            nextDayLabel,
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
        ],
        [
            "Overall Target ($)",
            `<span>
                ${formatNumber(overallTarget)}
            </span>`,
            `$${ (data.mtd2024 + data.rom2024).toLocaleString() }<sub><small>2024</small></sub> + $${growthAmount.toLocaleString()}<sub><small>Growth of ${growthType === 'percent' ? `${growthTarget}%` : `$${growthTarget.toLocaleString()}K`}</small></sub>`
        ],
        [
            "Remaining to Target ($)",
            remaining$ <= 0 
                ? `<span style="color: green; font-weight: bold;">✓ Target Met</span>` 
                : `<span>
                       ${formatNumber(remaining$)}
                   </span>`,
            `$${overallTarget.toLocaleString()}<sub><small>Target</small></sub> − $${data.mtd2025.toLocaleString()}<sub><small>MTD 2025</small></sub>`
        ],
        [
            "Growth Needed for ROM (%)",
            remaining$ <= 0 
                ? `<span style="color: green; font-weight: bold;">✓ Target Met</span>` 
                : `<span style="color: ${growthNeededPct >= 0 ? 'green' : 'red'};">
                       ${formatPercent(growthNeededPct)}
                   </span>`,
            `Target ${formatNumber(remaining$)}<sub><small>ROM</small></sub> / $${data.rom2024.toLocaleString()}<sub><small>2024</small></sub>`
        ],
        [
            "Next Day Targeted Net Sales",
            `<span style="color: ${nextDayTarget.value >= 0 ? 'green' : 'red'};">
                ${formatNumber(nextDayTarget.value)}
            </span>`,
            nextDayTarget.source
        ],
        [
            "Expected Orders",
            `<span>
                ${Math.round(nextDayTarget.customers)}
            </span>`,
            `Avg from last ${nextDayTarget.recentCount} ${nextDayTarget.nextWeekday}s before ${nextDayTarget.nextDateStr}`
        ],
[
            "AOV Target",
            `<span>
                $${(nextDayTarget.value / nextDayTarget.customers).toFixed(2)}
            </span>`,
            `Target ${formatNumber(nextDayTarget.value)} / ${Math.round(nextDayTarget.customers)} customers`
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
    } else {
        tr.innerHTML = `
            <td style="padding:3px;">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
            <td style="padding:3px; color:#666; font-size: small; font-style:italic;">${source}</td>
        `;
    }
    tbody.appendChild(tr);
});

    


    
}

function updateChartForSummaryRow(rowKey) {
    const store = document.getElementById('store-filter').value || 'CAFE';
    const month = document.getElementById('month-filter').value || '';
    const container = document.getElementById('chart-container');
    const canvas = document.getElementById('dynamic-chart');
    if (!container || rowKey !== 'next-day') return;

    // Hide canvas, show HTML mode
    canvas.style.display = 'none';
    container.style.display = 'block';

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

        // Precompute data per day (sales $, orders #)
        const dayData2024 = {}, dayData2025 = {};
        for (let d = 1; d <= totalDays; d++) {
            dayData2024[d] = { sales: 0, orders: 0 };
            dayData2025[d] = { sales: 0, orders: 0 };

            // 2024 sales/orders
            netsalesData.forEach(row => {
                const rowDate = new Date(row[2]);
                if (rowDate.getFullYear() === 2024 && rowDate.toLocaleString('en-US', { month: 'long' }) === month && rowDate.getDate() === d) {
                    const salesVal = row[storeColumns[store]];
                    dayData2024[d].sales = parseFloat(salesVal?.toString().replace(/[^0-9.-]+/g, '') || 0);
                    const orderRow = ordersData.find(o => new Date(o[2]).getTime() === rowDate.getTime());
                    dayData2024[d].orders = parseFloat(orderRow?.[storeColumns[store]] || 0);
                }
            });

            // 2025 sales/orders
            netsalesData.forEach(row => {
                const rowDate = new Date(row[2]);
                if (rowDate.getFullYear() === 2025 && rowDate.toLocaleString('en-US', { month: 'long' }) === month && rowDate.getDate() === d) {
                    const salesVal = row[storeColumns[store]];
                    dayData2025[d].sales = parseFloat(salesVal?.toString().replace(/[^0-9.-]+/g, '') || 0);
                    const orderRow = ordersData.find(o => new Date(o[2]).getTime() === rowDate.getTime());
                    dayData2025[d].orders = parseFloat(orderRow?.[storeColumns[store]] || 0);
                }
            });
        }

        // Build calendars
        const weeks = Math.ceil((totalDays + (new Date(2025, monthIndex, 1).getDay() || 7) - 1) / 7); // Weeks needed
        let html = `
            <div style="text-align: center; margin: 10px 0;">
                <h3 style="color: #34495e; margin: 0;">Month Comparison: ${month} 2024 vs. 2025 (Elapsed Days Highlighted)</h3>
                <p style="color: #666; font-size: 0.9em;">Green: Elapsed | Outlined: Next Day | Bold: Has Data</p>
            </div>
            <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">
        `;

        [2024, 2025].forEach(year => {
            const is2025 = year === 2025;
            const dayData = is2025 ? dayData2025 : dayData2024;
            const elapsedStart = is2025 ? 1 : elapsedStart2024;
            const elapsedEnd = is2025 ? elapsedDay2025 : Math.min(elapsedEnd2024, totalDays);

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

            let currentWeek = new Date(year, monthIndex, 1).getDay(); // 1=Sun, 7=Sat
            let day = 1;
            for (let w = 0; w < weeks; w++) {
                html += '<tr>';
                for (let wd = 1; wd <= 7; wd++) { // Sun=1, Sat=7
                    if (currentWeek > 0) {
                        html += '<td style="border: 1px solid #ddd; padding: 2px; height: 40px; vertical-align: top; background: #f9f9f9;"></td>';
                        currentWeek--;
                    } else if (day > totalDays) {
                        html += '<td style="border: 1px solid #ddd; padding: 2px; height: 40px; vertical-align: top; background: #f0f0f0;"></td>';
                    } else {
                        const salesK = (dayData[day].sales / 1000).toFixed(1);
                        const orders = dayData[day].orders;
                        const hasData = dayData[day].sales > 0;
                        const dayStr = day.toString();
                        let cellStyle = 'border: 1px solid #ddd; padding: 2px; height: 40px; vertical-align: top;';
                        let content = `<div style="font-weight: ${hasData ? 'bold' : 'normal'};">${dayStr}</div>`;

                        // Background/Outline logic
                        const inElapsed = day >= elapsedStart && day <= elapsedEnd;
                        if (inElapsed) {
                            cellStyle += ' background-color: #d4edda;'; // Light green
                        } else if (day > elapsedEnd) {
                            cellStyle += ' background-color: #f8f9fa;'; // Light gray
                        }

                        // Current Day (2025 only, not for past months) - no marker or outline
                        // No action for current day

                        // Next Day (2025 only, skip for past months) - outline here
                        if (is2025 && !isPastMonth && day === nextDay2025.getDate() && !isMonthComplete) {
                            cellStyle += ' border: 2px solid #28a745 !important; background-color: #fff3cd !important;'; // Yellow bg + Green outline
                        }

                        // Metrics
                        if (dayData[day].sales > 0 || orders > 0) {
                            content += `<div style="font-size: 0.7em; line-height: 1.1;">
                                <small>$${salesK}K</small><br>
                                <small>${orders || ''}</small>
                            </div>`;
                        }

                        html += `<td style="${cellStyle}" title="Sales: $${dayData[day].sales.toLocaleString()} | Orders: ${orders}">${content}</td>`;
                        day++;
                    }
                }
                html += '</tr>';
            }
            html += '</tbody></table></div>';
        });

        html += '</div>';
        container.innerHTML = html;
    }

    // For other rows, extend similarly (e.g., if (rowKey === 'mtd-growth') { ... })
}