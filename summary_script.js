const API_KEY = 'AIzaSyAbqqoWEYouY2nlLojZIXR1MFo7C0s-gQY';
const SPREADSHEET_ID = '1whPL4X-I815XVKbeFDxEHbhHbddUtb1XwsSE7MUaWYo';
const DISCOVERY_DOCS = ['https://sheets.googleapis.com/$discovery/rest?version=v4'];
const CURRENT_DATE = new Date('2025-11-13'); // Fixed to provided date
const storeColumns = { CAFE: 3, FEELLOVE: 4, SNOW: 5, ZION: 6 };
let netsalesData = null;
let ordersData = null;
let lastModifiedTime = null;

let currentSalesAvgs = {}, currentOrdersAvgs = {}, currentAovAvgs = {}, currentSalesSums = {}, currentOrdersSums = {}, currentAggMode = 'average', currentViewMode = 'raw';

/* -------------------------------------------------------------
   INITIAL LOAD
   ------------------------------------------------------------- */
function initClient() {
    gapi.load('client', () => {
        gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS })
            .then(() => loadSheetsData())
            .then(refreshed => {
                if (refreshed) populateMonthDropdown();
                // Auto-select current month/year
                document.getElementById('month-filter').value = CURRENT_DATE.toLocaleString('en-US', { month: 'long' });
                document.getElementById('year-filter').value = CURRENT_DATE.getFullYear();
                updateTables();
            })
            .catch(err => {
                console.error('Init error:', err);
             //  setStatus('Init error');
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
           // setStatus('Data up-to-date (cached)');
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
        

        
   //     setStatus(`Loaded data through ${CURRENT_DATE.toLocaleDateString()}`);
        return true;
    } catch (e) {
        console.error('loadSheetsData error:', e);
  //      setStatus('Error loading data');
        return false;
    }
}

/* -------------------------------------------------------------
   Helper – set status in right panel
   ------------------------------------------------------------- */
function setStatus(txt) {
    const panel = document.querySelector('.right-panel p');
    if (panel) panel.textContent = `Status: ${txt}`;
}

/* -------------------------------------------------------------
   MONTH DROPDOWN – CHRONOLOGICAL ORDER (for selected year)
   ------------------------------------------------------------- */
function populateMonthDropdown() {
    const year = document.getElementById('year-filter')?.value || '2025';
    const monthOrder = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const seen = new Set();
    netsalesData.forEach(r => {
        const d = new Date(r[2]);
        if (isNaN(d) || d.getFullYear().toString() !== year) return;
        const m = d.toLocaleString('en-US', { month: 'long' });
        seen.add(m);
    });
    const months = Array.from(seen).sort((a, b) => monthOrder.indexOf(a) - monthOrder.indexOf(b));
    const sel = document.getElementById('month-filter');
    if (!sel) return;
    
    // Preserve current selection before rebuilding
    const currentMonth = sel.value;
    
    sel.innerHTML = '<option value="">All Months</option>';
    months.forEach(m => sel.innerHTML += `<option value="${m}">${m}</option>`);
    
    // Restore if still valid
    if (currentMonth && months.includes(currentMonth)) {
        sel.value = currentMonth;
    }
}

/* -------------------------------------------------------------
   MAIN UPDATE – Populates all tables
   ------------------------------------------------------------- */
function updateTables() {
    const month = document.getElementById('month-filter')?.value || '';
    const year = document.getElementById('year-filter')?.value || '2025';
    const viewMode = document.getElementById('view-mode')?.value || 'raw';
    const aggMode = document.getElementById('agg-mode')?.value || 'average';
    if (!netsalesData || !ordersData) return;
    
   // setStatus(`Updating for ${month || 'All Months'} ${year} (${viewMode}, ${aggMode})...`);
    
    // Re-populate months if year changed
    populateMonthDropdown();
    
    // Calculate avgs and raw sums
    const result = calculateAveragesAndSumsByDayAndStore(year, month, viewMode);
    const { sales: salesAvgs, orders: ordersAvgs, aov: aovAvgs, salesSums, ordersSums } = result;
    
    updateSalesTable(salesAvgs, salesSums, viewMode, aggMode);
    updateOrdersTable(ordersAvgs, ordersSums, viewMode, aggMode);
    updateAOVTable(aovAvgs, salesSums, ordersSums, viewMode, aggMode);
    updateWeekdayCountTable(year, month);
    
// Store for charts  
currentSalesAvgs = salesAvgs;  
currentOrdersAvgs = ordersAvgs;  
currentAovAvgs = aovAvgs;  
currentSalesSums = salesSums;  
currentOrdersSums = ordersSums;  
currentAggMode = aggMode;  
currentViewMode = viewMode;  
// Refresh chart if visible  
// Refresh chart if visible (in-place update)  
if (currentChartType && chartInstance) {  
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];  
    const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];  
    const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0'];  
    const newDatasets = [];  
    let yLabel = '';  
    let yFormatter = v => v;  
    let chartTitle = '';  

    if (currentChartType === 'sales') {  
        chartTitle = 'Net Sales by Day of Week';  
        yLabel = 'Net Sales';  
        yFormatter = v => `$${Math.round(Math.abs(v)).toLocaleString()}`;  
        stores.forEach((store, i) => {  
            const data = days.map(day => {  
                const avgs = currentSalesAvgs[day] || {};  
                const sums = currentSalesSums[day] || {};  
                return currentAggMode === 'sum' ? (sums[store] || 0) : (avgs[store] || 0);  
            });  
            newDatasets.push({ label: store, data, backgroundColor: colors[i], borderColor: colors[i], borderWidth: 1 });  
        });  
    } else if (currentChartType === 'orders') {  
        chartTitle = 'Traffic (Orders) by Day of Week';  
        yLabel = 'Orders';  
        yFormatter = v => Math.round(Math.abs(v)).toLocaleString();  
        stores.forEach((store, i) => {  
            const data = days.map(day => {  
                const avgs = currentOrdersAvgs[day] || {};  
                const sums = currentOrdersSums[day] || {};  
                return currentAggMode === 'sum' ? (sums[store] || 0) : (avgs[store] || 0);  
            });  
            newDatasets.push({ label: store, data, backgroundColor: colors[i], borderColor: colors[i], borderWidth: 1 });  
        });  
    } else if (currentChartType === 'aov') {  
        chartTitle = 'Average Order Value by Day of Week';  
        yLabel = 'AOV';  
        yFormatter = v => `$${Math.abs(v).toFixed(2)}`;  
        stores.forEach((store, i) => {  
            const data = days.map(day => currentAovAvgs[day]?.[store] || 0);  
            newDatasets.push({ label: store, data, backgroundColor: colors[i], borderColor: colors[i], borderWidth: 1 });  
        });  
    }  

    chartInstance.data.datasets = newDatasets;  
    chartInstance.options.plugins.title.text = `${chartTitle} (${currentAggMode.charAt(0).toUpperCase() + currentAggMode.slice(1)})`;  
    chartInstance.options.scales.y.title.text = yLabel;  
    chartInstance.options.scales.y.ticks.callback = yFormatter;  
    chartInstance.update('none'); // Immediate, no animation redraw  
}  


   //('Tables updated');
}

/* -------------------------------------------------------------
   CALCULATE AVERAGES AND RAW SUMS BY DAY OF WEEK AND STORE
   ------------------------------------------------------------- */
function calculateAveragesAndSumsByDayAndStore(year, month, viewMode) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const salesByDayStore = {}; // Raw sums here
    const ordersByDayStore = {}; // Raw sums here
    days.forEach(d => {
        salesByDayStore[d] = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0, count: 0 };
        ordersByDayStore[d] = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0, count: 0 };
    });
    
    // Filter data by year and month
    const filteredSales = netsalesData.filter(row => {
        const d = new Date(row[2]);
        if (isNaN(d) || d.getFullYear().toString() !== year) return false;
        if (month && d.toLocaleString('en-US', { month: 'long' }) !== month) return false;
        return true;
    });
    const filteredOrders = ordersData.filter(row => {
        const d = new Date(row[2]);
        if (isNaN(d) || d.getFullYear().toString() !== year) return false;
        if (month && d.toLocaleString('en-US', { month: 'long' }) !== month) return false;
        return true;
    });
    

    
    // Separate loop for sales (accumulate raw sums)
    filteredSales.forEach((row, index) => {
        if (row.length < 7) {
            return;
        }
        const d = new Date(row[2]);
        if (isNaN(d)) {
            return;
        }
        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        if (!days.includes(dayName)) {
            return;
        }
        // Safety init
        if (!salesByDayStore[dayName]) {
            salesByDayStore[dayName] = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0, count: 0 };
        }
        salesByDayStore[dayName].count++;
        const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];
        stores.forEach(store => {
            const col = storeColumns[store];
            const value = parseFloat(row[col]?.toString().replace(/[^0-9.-]+/g, '') || 0);
            salesByDayStore[dayName][store] += value;
        });
    });
    
    // Separate loop for orders (accumulate raw sums)
    filteredOrders.forEach((row, index) => {
        if (row.length < 7) {
            return;
        }
        const d = new Date(row[2]);
        if (isNaN(d)) {
            return;
        }
        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        if (!days.includes(dayName)) {
            return;
        }
        // Safety init
        if (!ordersByDayStore[dayName]) {
            ordersByDayStore[dayName] = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0, count: 0 };
        }
        ordersByDayStore[dayName].count++;
        const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];
        stores.forEach(store => {
            const col = storeColumns[store];
            const value = parseFloat(row[col]?.toString().replace(/[^0-9.-]+/g, '') || 0);
            ordersByDayStore[dayName][store] += value;
        });
    });
    
    // Sync counts
    days.forEach(d => {
        const sCount = salesByDayStore[d]?.count || 0;
        const oCount = ordersByDayStore[d]?.count || 0;
        const avgCount = Math.round((sCount + oCount) / 2);
        if (salesByDayStore[d]) salesByDayStore[d].count = avgCount;
        if (ordersByDayStore[d]) ordersByDayStore[d].count = avgCount;
    });
    
    // Init all days for avgs (Ensure all days exist, even if no data)
    const salesAvgs = {}, ordersAvgs = {}, aovAvgs = {};
    days.forEach(day => {
        salesAvgs[day] = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0 };
        ordersAvgs[day] = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0 };
        aovAvgs[day] = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0 };
    });
    
    // Calculate averages from sums and apply view mode (only if count > 0)
    days.forEach(day => {
        const sDay = salesByDayStore[day];
        const oDay = ordersByDayStore[day];
        const count = sDay ? sDay.count : 0;
        if (count === 0) return; // Skip calc, but objects are initialized to 0
        
        const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];
        stores.forEach(store => {
            const salesAvg = sDay[store] / count;
            const ordersAvg = oDay[store] / count;
            let salesVal = salesAvg;
            let ordersVal = ordersAvg;
            
            if (viewMode === 'growth-dollar' || viewMode === 'growth-percent') {
                const baseYear = year === '2025' ? '2024' : '2025';
                const baseSales = getYearlyAvgForDayStore(baseYear, month, day, store, 'sales');
                const baseOrders = getYearlyAvgForDayStore(baseYear, month, day, store, 'orders');
                if (viewMode === 'growth-dollar') {
                    salesVal = salesAvg - baseSales;
                    ordersVal = ordersAvg - baseOrders;
                } else {
                    salesVal = baseSales > 0 ? ((salesAvg / baseSales) - 1) * 100 : 0;
                    ordersVal = baseOrders > 0 ? ((ordersAvg / baseOrders) - 1) * 100 : 0;
                }
            }
            
            salesAvgs[day][store] = salesVal;
            ordersAvgs[day][store] = ordersVal;
        });
        
        // AOV: Weighted avg from raw sums
        stores.forEach(store => {
            const rawSalesSum = sDay[store];
            const rawOrdersSum = oDay[store];
            const rawAOV = rawOrdersSum > 0 ? rawSalesSum / rawOrdersSum : 0;
            let aovVal = rawAOV;
            if (viewMode === 'growth-dollar' || viewMode === 'growth-percent') {
                const baseYear = year === '2025' ? '2024' : '2025';
                const baseAOV = getYearlyAvgForDayStore(baseYear, month, day, store, 'aov');
                if (viewMode === 'growth-dollar') {
                    aovVal = rawAOV - baseAOV;
                } else {
                    aovVal = baseAOV > 0 ? ((rawAOV / baseAOV) - 1) * 100 : 0;
                }
            }
            aovAvgs[day][store] = aovVal;
        });
    });
    
    return { sales: salesAvgs, orders: ordersAvgs, aov: aovAvgs, salesSums: salesByDayStore, ordersSums: ordersByDayStore };
}

// Helper: Get base year avg for growth calcs (with safety for no data)
function getYearlyAvgForDayStore(baseYear, month, day, store, metric) {
    try {
        // Simplified: Recalc for base year with 'raw' mode, return the raw avg
        const tempAvgs = calculateAveragesAndSumsByDayAndStore(baseYear, month, 'raw');
        const dayData = tempAvgs[metric === 'sales' ? 'sales' : metric === 'orders' ? 'orders' : 'aov'][day];
        return dayData && dayData[store] !== undefined ? dayData[store] : 0;
    } catch (e) {
        return 0; // Safety default
    }
}

/* -------------------------------------------------------------
   UPDATE SALES TABLE
   ------------------------------------------------------------- */
function updateSalesTable(salesAvgs, salesSums, viewMode, aggMode) {
    const tbody = document.getElementById('sales-table').querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let monthlyTotals = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0 };
    
    days.forEach(day => {
        const row = document.createElement('tr');
        let dayTotal = 0;
        const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];
        let cells = `<td>${day}</td>`;
        stores.forEach(store => {
            const avgVal = (salesAvgs[day] && salesAvgs[day][store]) ? salesAvgs[day][store] : 0; // Safety
            const sumVal = (salesSums[day] && salesSums[day][store]) ? salesSums[day][store] : 0; // Safety
            const displayVal = aggMode === 'sum' ? sumVal : avgVal;
            cells += `<td>${formatValue(displayVal, 'sales', viewMode)}</td>`;
            monthlyTotals[store] += sumVal;
            dayTotal += displayVal;
        });
        cells += `<td><strong>${formatValue(dayTotal, 'sales', viewMode)}</strong></td>`;
        row.innerHTML = cells;
        tbody.appendChild(row);
    });
    
    // Calculate total days from synced counts
    const totalDays = days.reduce((acc, day) => acc + (salesSums[day]?.count || 0), 0);
    
    // Footer row: Aggregate monthly totals per store
    const footerLabel = aggMode === 'average' ? 'Average' : 'Total';
    const footer = document.createElement('tr');
    footer.style.fontWeight = 'bold';
    footer.style.backgroundColor = '#e6e6e6';
    let footerCells = `<td><strong>${footerLabel}</strong></td>`;
    const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];
    let grandTotal = 0;
    stores.forEach(store => {
        const rawTotal = monthlyTotals[store];
        const displayTotal = aggMode === 'sum' ? rawTotal : (totalDays > 0 ? rawTotal / totalDays : 0);
        footerCells += `<td><strong>${formatValue(displayTotal, 'sales', viewMode)}</strong></td>`;
        grandTotal += displayTotal;
    });
    footerCells += `<td><strong>${formatValue(grandTotal, 'sales', viewMode)}</strong></td>`;
    footer.innerHTML = footerCells;
    tbody.appendChild(footer);
}

/* -------------------------------------------------------------
   UPDATE ORDERS TABLE
   ------------------------------------------------------------- */
function updateOrdersTable(ordersAvgs, ordersSums, viewMode, aggMode) {
    const tbody = document.getElementById('orders-table').querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let monthlyTotals = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0 };
    
    days.forEach(day => {
        const row = document.createElement('tr');
        let dayTotal = 0;
        const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];
        let cells = `<td>${day}</td>`;
        stores.forEach(store => {
            const avgVal = (ordersAvgs[day] && ordersAvgs[day][store]) ? ordersAvgs[day][store] : 0; // Safety
            const sumVal = (ordersSums[day] && ordersSums[day][store]) ? ordersSums[day][store] : 0; // Safety
            const displayVal = aggMode === 'sum' ? sumVal : avgVal;
            cells += `<td>${formatValue(displayVal, 'orders', viewMode)}</td>`;
            monthlyTotals[store] += sumVal;
            dayTotal += displayVal;
        });
        cells += `<td><strong>${formatValue(dayTotal, 'orders', viewMode)}</strong></td>`;
        row.innerHTML = cells;
        tbody.appendChild(row);
    });
    
    // Calculate total days from synced counts
    const totalDays = days.reduce((acc, day) => acc + (ordersSums[day]?.count || 0), 0);
    
    // Footer row: Aggregate monthly totals per store
    const footerLabel = aggMode === 'average' ? 'Average' : 'Total';
    const footer = document.createElement('tr');
    footer.style.fontWeight = 'bold';
    footer.style.backgroundColor = '#e6e6e6';
    let footerCells = `<td><strong>${footerLabel}</strong></td>`;
    const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];
    let grandTotal = 0;
    stores.forEach(store => {
        const rawTotal = monthlyTotals[store];
        const displayTotal = aggMode === 'sum' ? rawTotal : (totalDays > 0 ? rawTotal / totalDays : 0);
        footerCells += `<td><strong>${formatValue(displayTotal, 'orders', viewMode)}</strong></td>`;
        grandTotal += displayTotal;
    });
    footerCells += `<td><strong>${formatValue(grandTotal, 'orders', viewMode)}</strong></td>`;
    footer.innerHTML = footerCells;
    tbody.appendChild(footer);
}

/* -------------------------------------------------------------
   UPDATE AOV TABLE
   ------------------------------------------------------------- */
function updateAOVTable(aovAvgs, salesSums, ordersSums, viewMode, aggMode) {
    const tbody = document.getElementById('aov-table').querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let monthlySalesTotals = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0 };
    let monthlyOrdersTotals = { CAFE: 0, FEELLOVE: 0, SNOW: 0, ZION: 0 };
    
    days.forEach(day => {
        const row = document.createElement('tr');
        let dayTotalSales = 0, dayTotalOrders = 0;
        const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];
        let cells = `<td>${day}</td>`;
        stores.forEach(store => {
            const avgVal = (aovAvgs[day] && aovAvgs[day][store]) ? aovAvgs[day][store] : 0; // Safety
            const daySales = (salesSums[day] && salesSums[day][store]) ? salesSums[day][store] : 0; // Safety
            const dayOrders = (ordersSums[day] && ordersSums[day][store]) ? ordersSums[day][store] : 0; // Safety
            // For AOV, aggregate mode doesn't directly apply (it's always "average"), but we can keep it as-is for now
            cells += `<td>${formatValue(avgVal, 'aov', viewMode)}</td>`;
            monthlySalesTotals[store] += daySales;
            monthlyOrdersTotals[store] += dayOrders;
            dayTotalSales += daySales;
            dayTotalOrders += dayOrders;
        });
        const dayAOV = dayTotalOrders > 0 ? dayTotalSales / dayTotalOrders : 0;
        cells += `<td><strong>${formatValue(dayAOV, 'aov', viewMode)}</strong></td>`;
        row.innerHTML = cells;
        tbody.appendChild(row);
    });
    
    // Calculate grand totals for overall AOV
    let grandSalesTotal = 0, grandOrdersTotal = 0;
    const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];
    stores.forEach(store => {
        grandSalesTotal += monthlySalesTotals[store];
        grandOrdersTotal += monthlyOrdersTotals[store];
    });
    const grandAOV = grandOrdersTotal > 0 ? grandSalesTotal / grandOrdersTotal : 0;
    
    // Footer row: Monthly weighted AOV per store
    const footer = document.createElement('tr');
    footer.style.fontWeight = 'bold';
    footer.style.backgroundColor = '#e6e6e6';
    let footerCells = '<td>Total</td>';
    stores.forEach(store => {
        const monthlyAOV = monthlyOrdersTotals[store] > 0 ? monthlySalesTotals[store] / monthlyOrdersTotals[store] : 0;
        footerCells += `<td><strong>${formatValue(monthlyAOV, 'aov', viewMode)}</strong></td>`;
    });
    footerCells += `<td><strong>${formatValue(grandAOV, 'aov', viewMode)}</strong></td>`;
    footer.innerHTML = footerCells;
    tbody.appendChild(footer);
}

/* -------------------------------------------------------------
   UPDATE WEEKDAY COUNT TABLE
   ------------------------------------------------------------- */
function updateWeekdayCountTable(year, month) {
    const tbody = document.getElementById('weekday-count-table').querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let totalDays = 0;
    
    const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
    const lastDay = month ? new Date(year, monthIndex + 1, 0).getDate() : 31; // Default 31 if no month
    
    days.forEach(day => {
        let count = 0;
        for (let d = 1; d <= lastDay; d++) {
            const date = new Date(year, monthIndex, d);
            if (date.toLocaleString('en-US', { weekday: 'long' }) === day) count++;
        }
        const row = document.createElement('tr');
        row.innerHTML = `<td>${day}</td><td>${count}</td>`;
        tbody.appendChild(row);
        totalDays += count;
    });
    
    // Total row
    const totalRow = document.createElement('tr');
    totalRow.style.fontWeight = 'bold';
    totalRow.style.backgroundColor = '#e6e6e6';
    totalRow.innerHTML = `<td><strong>Total</strong></td><td><strong>${totalDays}</strong></td>`;
    tbody.appendChild(totalRow);
}

/* -------------------------------------------------------------
   FORMATTING HELPERS
   ------------------------------------------------------------- */
function formatValue(v, type, viewMode) {
    if (v === 0) return type === 'orders' ? '0' : type === 'aov' ? '$0.00' : '$0';
    const abs = Math.abs(v);
    if (type === 'orders') return Math.round(abs).toLocaleString();
    if (type === 'aov') return `$${abs.toFixed(2)}`;
    if (type === 'sales') {
        if (viewMode === 'growth-percent') return `${abs.toFixed(1)}%`;
        if (viewMode === 'growth-dollar') return `$${Math.round(abs).toLocaleString()}`;
        return `$${Math.round(abs).toLocaleString()}`;
    }
    return v;
}

let chartInstance = null; // Global to track/destroy chart  
let currentChartType = null; // Track which chart is active  

function toggleChart(type, title, force = false) {
    const container = document.getElementById('chart-container');  
    const canvas = document.getElementById('dynamic-chart');  
    if (!container || !canvas) return; // Safety  

    const isVisible = getComputedStyle(container).display !== 'none';  
   if (isVisible && currentChartType === type && !force) {  
        // Already visible and same type: Do nothing (no hide)  
        return;  
    }

    // If different type or hidden: Show and create (destroy old if needed)  
    if (chartInstance) {  
        chartInstance.destroy();  
        chartInstance = null;  
    }  
    container.style.display = 'block';  
    currentChartType = type;  
    const ctx = canvas.getContext('2d');  
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear any old drawing  

    // Prep data based on type/aggMode  
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];  
    const stores = ['CAFE', 'FEELLOVE', 'SNOW', 'ZION'];  
    const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0']; // Per-store colors  
    let datasets = [];  
    let yLabel = '';  
    let yFormatter = (v) => v;  

    if (type === 'sales') {  
        yLabel = 'Net Sales';  
        yFormatter = (v) => `$${Math.round(Math.abs(v)).toLocaleString()}`;  
        stores.forEach((store, i) => {  
            const data = days.map(day => {  
                const avgs = currentSalesAvgs[day] || {};  
                const sums = currentSalesSums[day] || {};  
                const val = currentAggMode === 'sum' ? (sums[store] || 0) : (avgs[store] || 0);  
                return val;  
            });  
            datasets.push({ label: store, data, backgroundColor: colors[i], borderColor: colors[i], borderWidth: 1 });  
        });  
    } else if (type === 'orders') {  
        yLabel = 'Orders';  
        yFormatter = (v) => Math.round(Math.abs(v)).toLocaleString();  
        stores.forEach((store, i) => {  
            const data = days.map(day => {  
                const avgs = currentOrdersAvgs[day] || {};  
                const sums = currentOrdersSums[day] || {};  
                const val = currentAggMode === 'sum' ? (sums[store] || 0) : (avgs[store] || 0);  
                return val;  
            });  
            datasets.push({ label: store, data, backgroundColor: colors[i], borderColor: colors[i], borderWidth: 1 });  
        });  
    } else if (type === 'aov') {  
        yLabel = 'AOV';  
        yFormatter = (v) => `$${Math.abs(v).toFixed(2)}`;  
        stores.forEach((store, i) => {  
            const data = days.map(day => {  
                const avgs = currentAovAvgs[day] || {};  
                return avgs[store] || 0;  
            });  
            datasets.push({ label: store, data, backgroundColor: colors[i], borderColor: colors[i], borderWidth: 1 });  
        });  
    }  

    // Create new  
    chartInstance = new Chart(ctx, {  
        type: 'bar',  
        data: { labels: days, datasets },  
        options: {  
            responsive: true,  
            maintainAspectRatio: false,  
            plugins: {  
                title: { display: true, text: `${title} (${currentAggMode})` },  
                legend: { position: 'top' }  
            },  
            scales: {  
                y: {  
                    beginAtZero: true,  
                    title: { display: true, text: yLabel },  
                    ticks: { callback: yFormatter }  
                }  
            }  
        }  
    });  
}   


/* -------------------------------------------------------------
   START – Init on load
   ------------------------------------------------------------- */
window.onload = () => {
    // Add change listeners
    ['month-filter', 'year-filter', 'view-mode', 'agg-mode'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateTables);
    });
    // Add click handlers for section headers  
const headers = {  
    'sales-h2': { type: 'sales', title: 'Net Sales by Day of Week' },  
    'orders-h2': { type: 'orders', title: 'Traffic (Orders) by Day of Week' },  
    'aov-h2': { type: 'aov', title: 'Order Value by Day of Week' }  
};  
Object.entries(headers).forEach(([id, info]) => {  
    const el = document.getElementById(id);  
    if (el) {  
        el.addEventListener('click', () => toggleChart(info.type, info.title));  
    }  
});  
    initClient();
};