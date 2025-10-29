const API_KEY = 'AIzaSyAbqqoWEYouY2nlLojZIXR1MFo7C0s-gQY';
const SPREADSHEET_ID = '1whPL4X-I815XVKbeFDxEHbhHbddUtb1XwsSE7MUaWYo';
const DISCOVERY_DOCS = ['https://sheets.googleapis.com/$discovery/rest?version=v4'];
const CURRENT_DATE = new Date();
const storeColumns = { CAFE: 3, FEELLOVE: 4, SNOW: 5, ZION: 6 };

let netsalesData = null;
let ordersData = null;
let growthTarget = 10;
let growthType = 'percent';
let isAdjusted = false;
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
        { label: `${month} Growth Target`, mtd: data.mtdTarget, rom: data.romTarget },
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
        { label: `${month} ${new Date().getFullYear()} at ${growthTarget}% Growth Rate`, rom: data.romTarget },
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
        romTarget: romTarget
    };
}

/* -------------------------------------------------------------
   FORMATTING
   ------------------------------------------------------------- */
function formatNumber(v, aov = false) {
    if (v === 0) return aov ? '$0.00' : '$0';
    const abs = Math.abs(v);
    const fmt = aov ? abs.toFixed(2) : Math.round(abs).toString();
    return v < 0 ? `<span class="negative">($${fmt})</span>` : `$${fmt}`;
}
function formatPercent(v) {
    if (v === '∞') return v;
    if (v === 0) return '0.0%';
    const fmt = Math.abs(v).toFixed(1);
    return v < 0 ? `<span class="negative">(${fmt}%)</span>` : `${fmt}%`;
}

/* -------------------------------------------------------------
   START – auto-select current month
   ------------------------------------------------------------- */
window.onload = () => {
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
    const source = `MAX(Target ${formatNumber(remaining$)}<sub>ROM</sub> × ${sharePct}% <sub>Single ${nextWeekday} share</sub>
,<br/>${formatNumber(nextDayAvg)}<sub>${nextWeekday} avg</sub> )`;

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
            tr.innerHTML = `
                <td style="padding:6px;">${metric}</td>
                <td style="text-align:right; padding:6px; font-weight:500;">${value}</td>
                <td style="padding:6px; color:#666; font-style:italic;">${source}</td>
            `;
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
            "Expected Customers (ROM)",
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
        tr.innerHTML = `
            <td style="padding:3px;">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
            <td style="padding:3px; color:#666; font-size: small; font-style:italic;">${source}</td>
        `;
        tbody.appendChild(tr);
    });

    
}
