const API = 'http://localhost:5000/api';
const token = localStorage.getItem('token');
const userRole = localStorage.getItem('role');

// Security Check
if (!token) location.href = 'index.html';

// Role-Based Access Control (RBAC)
if (userRole === 'Admin' || userRole === 'LabStaff') {
    const navTypes = document.getElementById('nav-types');
    if(navTypes) navTypes.style.display = 'block';
}

if (userRole !== 'Admin') { 
    if(document.getElementById('nav-users')) document.getElementById('nav-users').classList.add('hidden'); 
    if(document.getElementById('nav-labs')) document.getElementById('nav-labs').classList.add('hidden'); 
}

let statusChartInstance = null; 
let labChartInstance = null;
let availableLabs = [];
window.equipData = []; // Global store for supplier popups

// ==========================================
// 📡 CORE API FETCHER
// ==========================================
async function fetchAPI(ep, method = 'GET', body) {
    const opts = { method, headers: { 'Authorization': `Bearer ${token}` } };
    if (body && !(body instanceof FormData)) { 
        opts.headers['Content-Type'] = 'application/json'; 
        opts.body = JSON.stringify(body); 
    } else if (body) {
        opts.body = body;
    }
    const response = await fetch(API + ep, opts);
    if (!response.ok) throw new Error("API request failed");
    return response.json();
}

// ==========================================
// 🧭 DYNAMIC MODULE LOADER (THE ROUTER)
// ==========================================
async function show(page) {
    try {
        const response = await fetch(`views/${page}.html`);
        if (!response.ok) throw new Error("Page not found");
        
        const htmlText = await response.text();
        document.getElementById('main-content').innerHTML = htmlText;

        if(userRole === 'Approver' && document.getElementById('trans-form')) {
            document.getElementById('trans-form').classList.add('hidden');
        }

        // Trigger the necessary functions for that specific page
        if (page === 'home') { loadStats(); loadLabOptions(); }        
        if (page === 'equipment') loadEquipView(); 
        if (page === 'inventory') { loadLabOptions(); loadDropdownTypes(); }
        if (page === 'types') loadTypes(); 
        if (page === 'users') loadUsers();
        if (page === 'transfers') { loadTrans(); loadLabOptions(); }
        if (page === 'issues') { loadIssues(); loadLabOptions(); } 
        if (page === 'labs') loadLabs();
        if (page === 'stock') loadStock(); // Load the new Stock feature

    } catch (error) {
        console.error("Error loading module:", error);
        document.getElementById('main-content').innerHTML = `<h2>Error loading page. Make sure you are using a local server!</h2>`;
    }
}

// ==========================================
// 📊 HOME / DASHBOARD
// ==========================================
async function loadStats() {
    const d = await fetchAPI('/dashboard'); 
    if(document.getElementById('s-labs')) document.getElementById('s-labs').innerText = d.totalLabs; 
    if(document.getElementById('s-equip')) document.getElementById('s-equip').innerText = d.totalEquip; 
    if(document.getElementById('s-old')) document.getElementById('s-old').innerText = d.toReplace; 
    if(document.getElementById('s-warr')) document.getElementById('s-warr').innerText = d.warrantyExpired;
    
    const items = await fetchAPI('/equipments'); 
    renderCharts(items);
}

function renderCharts(items) { 
    if(statusChartInstance) statusChartInstance.destroy(); 
    if(labChartInstance) labChartInstance.destroy();

    const active = items.filter(i => i.status === 'Active').length; 
    const replace = items.filter(i => i.status === 'To Replace').length; 
    const expired = items.filter(i => i.status === 'Warranty Expired').length;
    
    const labCounts = {}; 
    items.forEach(i => { 
        const n = i.Lab ? i.Lab.lab_name : 'Unassigned'; 
        labCounts[n] = (labCounts[n] || 0) + 1; 
    });

    const ctx1 = document.getElementById('statusChart');
    if(ctx1) {
        statusChartInstance = new Chart(ctx1.getContext('2d'), { 
            type: 'doughnut', 
            data: { labels: ['Active', 'To Replace', 'Warranty Expired'], datasets: [{ data: [active, replace, expired], backgroundColor: ['#28a745', '#ffc107', '#dc3545'] }] } 
        });
    }

    const ctx2 = document.getElementById('labChart');
    if(ctx2) {
        labChartInstance = new Chart(ctx2.getContext('2d'), { 
            type: 'bar', 
            data: { labels: Object.keys(labCounts), datasets: [{ label: 'Items', data: Object.values(labCounts), backgroundColor: '#007bff' }] }, 
            options: { scales: { y: { beginAtZero: true } } } 
        });
    }
}

// ==========================================
// ⚙️ MANAGE EQUIPMENT TYPES
// ==========================================
async function loadTypes() {
    try {
        const types = await fetchAPI('/types');
        let html = '';
        types.forEach(t => {
            html += `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px;">${t.name}</td>
                <td style="padding: 10px;">
                    <button onclick="deleteType(${t.id})" class="btn" style="background: #dc3545; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Delete</button>
                </td>
            </tr>`;
        });
        if(document.getElementById('type-list')) {
            document.getElementById('type-list').innerHTML = html || '<tr><td colspan="2" style="padding:15px; text-align:center;">No types found.</td></tr>';
        }
    } catch (e) { console.error("Error loading types:", e); }
}

async function addType(e) {
    e.preventDefault();
    try {
        await fetchAPI('/types', 'POST', { name: document.getElementById('new_type_name').value });
        document.getElementById('new_type_name').value = '';
        loadTypes(); 
    } catch(e) { alert("Error adding type. It may already exist!"); }
}

async function deleteType(id) {
    if(!confirm("Are you sure you want to delete this equipment type?")) return;
    try {
        await fetchAPI(`/types/${id}`, 'DELETE');
        loadTypes(); 
    } catch(e) { console.error("Error deleting type:", e); }
}

async function loadDropdownTypes() {
    try {
        const types = await fetchAPI('/types');
        let html = '<option value="">Select Equipment Type</option>';
        types.forEach(t => { html += `<option value="${t.name}">${t.name}</option>`; });
        if(document.getElementById('inv_type')) document.getElementById('inv_type').innerHTML = html;
    } catch(e) { console.error("Error loading dropdown types:", e); }
}

// ==========================================
// 📦 ADD INVENTORY (MANUAL & EXCEL)
// ==========================================
async function submitInventory(e) {
    e.preventDefault(); 
    const payload = {
        lab_id: document.getElementById('inv_lab_id').value,
        item_name: document.getElementById('inv_name').value,
        type: document.getElementById('inv_type').value,              
        price: parseFloat(document.getElementById('inv_price').value) || 0, 
        serial_no: document.getElementById('inv_serial').value,
        supplier_contact: document.getElementById('inv_contact').value,
        specs: document.getElementById('inv_specs').value || 'N/A',
        supplier_info: document.getElementById('inv_supplier').value || 'N/A',
        purchase_date: document.getElementById('inv_purchase_date').value,
        warranty_end: document.getElementById('inv_warranty_end').value
    };

    try {
        await fetchAPI('/equipments', 'POST', payload);
        alert("Equipment successfully added to inventory!");
        document.getElementById('inventory-form').reset();
    } catch (error) {
        console.error("Error adding equipment:", error);
        alert("Failed to add equipment. Check console for details.");
    }
}

async function uploadExcel(e) { 
    if(e) e.preventDefault();
    const labId = document.getElementById('import_lab_id')?.value;
    const fileInput = document.getElementById('excel_file');

    if (!labId) return alert("Please select a target lab first!");
    if (!fileInput.files.length) return alert("Please select an Excel file!");

    const fd = new FormData(); 
    fd.append('file', fileInput.files[0]); 
    fd.append('lab_id', labId); 

    try {
        await fetchAPI('/equipments/import', 'POST', fd); 
        alert('Imported Successfully!'); 
        fileInput.value = ''; 
        document.getElementById('import_lab_id').value = ''; 
    } catch (error) {
        alert("Error importing data. Make sure your Excel columns are correct.");
    }
}

// ==========================================
// 🖥️ EQUIPMENT VIEW & SORTING
// ==========================================
async function loadEquipView() {
    try {
        let items = await fetchAPI('/equipments');
        window.equipData = items; 
        
        // Sorting Logic
        const sortDropdown = document.getElementById('sort-price');
        const sortVal = sortDropdown ? sortDropdown.value : 'none';

        if (sortVal === 'asc') {
            items.sort((a, b) => parseFloat(a.price || 0) - parseFloat(b.price || 0));
        } else if (sortVal === 'desc') {
            items.sort((a, b) => parseFloat(b.price || 0) - parseFloat(a.price || 0));
        }

        let expiredHtml = '';
        let groupedHtml = '';
        const labs = {};

        items.forEach(item => {
            const labName = item.Lab ? item.Lab.lab_name : 'Unassigned';
            const priceDisplay = item.price ? `Rs. ${item.price}` : 'Rs. 0.00';
            const typeDisplay = item.type || 'N/A';
            
            const rowHtml = `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 10px;">${item.item_name}</td>
                    <td style="padding: 10px; font-weight: 500; color: #0056b3;">${typeDisplay}</td>
                    <td style="padding: 10px; color: #28a745;">${priceDisplay}</td>
                    <td style="padding: 10px;">${item.serial_no}</td>
                    <td style="padding: 10px; font-size: 0.85em; color: gray;">${item.specs}</td>
                    <td style="padding: 10px;">${labName}</td>
                    <td style="padding: 10px;">${item.age} yrs</td>
                    <td style="padding: 10px; font-weight: bold; color: ${item.status === 'Active' ? 'green' : 'red'};">${item.status}</td>
                    <td style="padding: 10px; font-size: 0.85em;">${item.supplier_info || 'N/A'}</td>
                    <td style="padding: 10px;">
                        <button class="btn" style="background:#dc3545; color:white; padding:5px 10px; font-size:0.8em; border:none; border-radius:4px; cursor:pointer;" onclick="delItem(${item.id})">Delete</button>
                    </td>
                </tr>
            `;

            if (item.status !== 'Active') expiredHtml += rowHtml;

            if (!labs[labName]) labs[labName] = [];
            labs[labName].push(rowHtml);
        });

        if (document.getElementById('expired-list')) {
            document.getElementById('expired-list').innerHTML = expiredHtml || '<tr><td colspan="10" style="text-align:center; padding: 15px;">No expired or broken devices found.</td></tr>';
        }

        for (const [lab, rows] of Object.entries(labs)) {
            groupedHtml += `
                <h4 style="margin-top: 20px; color: #003366; background: #e9ecef; padding: 10px; border-radius: 5px;">📍 ${lab}</h4>
                <div class="card" style="padding: 0; overflow-x: auto; margin-bottom: 20px;">
                    <table class="table" style="width: 100%; text-align: left; border-collapse: collapse;">
                        <thead style="background: #f8f9fa;">
                            <tr style="border-bottom: 2px solid #ccc;">
                                <th style="padding: 10px;">Name</th>
                                <th style="padding: 10px;">Type</th>
                                <th style="padding: 10px;">Price</th>
                                <th style="padding: 10px;">Serial</th>
                                <th style="padding: 10px;">Specs</th>
                                <th style="padding: 10px;">Lab</th>
                                <th style="padding: 10px;">Age</th>
                                <th style="padding: 10px;">Status</th>
                                <th style="padding: 10px;">Supplier</th>
                                <th style="padding: 10px;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        if (document.getElementById('grouped-equip-list')) {
            document.getElementById('grouped-equip-list').innerHTML = groupedHtml || '<p style="padding: 20px; text-align: center;">No equipment found in the system.</p>';
        }

    } catch (error) { console.error("Error loading equipment:", error); }
}

function showSupplier(id) {
    const item = window.equipData.find(e => e.id === id);
    if(item) {
        alert(`🛒 SUPPLIER DETAILS\n\nEquipment: ${item.item_name} (${item.serial_no})\n\nName & Address:\n${item.supplier_info || 'Not Provided'}\n\nContact & Website:\n${item.supplier_contact || 'Not Provided'}`);
    }
}

async function delItem(id) { 
    if(confirm('Delete this item?')) { 
        await fetchAPI(`/equipments/${id}`, 'DELETE'); 
        loadEquipView(); 
    } 
}

// ==========================================
// 🏢 LAB DROPDOWNS
// ==========================================
async function loadLabOptions() {
    availableLabs = await fetchAPI('/labs');
    const opts = '<option value="">Select Lab...</option>' + availableLabs.map(l => `<option value="${l.id}">${l.lab_name}</option>`).join('');
    
    if(document.getElementById('inv_lab_id')) document.getElementById('inv_lab_id').innerHTML = opts;
    if(document.getElementById('import_lab_id')) document.getElementById('import_lab_id').innerHTML = opts;
    if(document.getElementById('t-src')) document.getElementById('t-src').innerHTML = opts;
    if(document.getElementById('t-dest')) document.getElementById('t-dest').innerHTML = opts;
    if(document.getElementById('issue-lab')) document.getElementById('issue-lab').innerHTML = opts; 
    
    if(document.getElementById('report-lab')) {
        document.getElementById('report-lab').innerHTML = '<option value="all">All Labs</option>' + availableLabs.map(l => `<option value="${l.id}">${l.lab_name}</option>`).join('');
    }
}

// ==========================================
// 🔄 TRANSFERS
// ==========================================
async function loadSourceItems() {
    const labId = document.getElementById('t-src').value; 
    const container = document.getElementById('transfer-items-container'); 
    container.innerHTML = 'Loading...';
    if(!labId) { container.innerHTML = 'Select a source lab first.'; return; }
    
    const items = await fetchAPI(`/equipments?lab_id=${labId}`);
    if(items.length === 0) { container.innerHTML = 'No equipment in this lab.'; return; }
    container.innerHTML = items.map(i => `<div class="transfer-item"><input type="checkbox" class="trans-checkbox" value="${i.id}"><span>${i.item_name} (SN: ${i.serial_no})</span></div>`).join('');
}

function toggleSelectAll(source) { 
    document.querySelectorAll('.trans-checkbox').forEach(cb => cb.checked = source.checked); 
}

async function reqTransfer() {
    const src = document.getElementById('t-src').value; 
    const dest = document.getElementById('t-dest').value; 
    const selected = Array.from(document.querySelectorAll('.trans-checkbox:checked')).map(cb => cb.value);
    
    if(!src || !dest) return alert("Select Source and Destination Labs"); 
    if(src === dest) return alert("Source and Destination cannot be the same!"); 
    if(selected.length === 0) return alert("Please select at least one item to transfer.");
    
    await fetchAPI('/transfers', 'POST', { source_lab_id: src, dest_lab_id: dest, items: selected }); 
    alert('Transfer Requested'); 
    loadTrans();
}

async function loadTrans() { 
    const d = await fetchAPI('/transfers'); 
    document.getElementById('trans-list').innerHTML = d.map(x => {
        let count = 0; 
        try { 
            let items = x.items; 
            if (typeof items === 'string') items = JSON.parse(items); 
            if (Array.isArray(items)) count = items.length; 
        } catch(e) { count = 0; }
        
        return `<tr>
            <td>${x.SourceLab?.lab_name || 'Unknown'}</td>
            <td>${x.DestLab?.lab_name || 'Unknown'}</td>
            <td><b>${count}</b> items</td>
            <td><span style="padding:5px 10px; border-radius:10px; background:${x.status==='Pending'?'#ffeeba':x.status==='Approved'?'#d4edda':'#f8d7da'}">${x.status}</span></td>
            <td>${userRole==='Approver' && x.status==='Pending' ? `<button class="btn" style="background:green;" onclick="updTrans(${x.id},'Approved')">✔</button> <button class="btn" style="background:red;" onclick="updTrans(${x.id},'Rejected')">✖</button>` : ''}</td>
        </tr>`;
    }).join(''); 
}

async function updTrans(id, st) { 
    await fetchAPI(`/transfers/${id}`, 'PUT', {status:st}); 
    loadTrans(); 
}

// ==========================================
// ⚠️ LINKED ISSUES
// ==========================================
async function loadIssueEquip() {
    const labId = document.getElementById('issue-lab').value;
    const equipSelect = document.getElementById('issue-equip');
    if (!labId) { equipSelect.innerHTML = '<option value="">Select Equipment...</option>'; return; }
    
    const items = await fetchAPI(`/equipments?lab_id=${labId}`);
    equipSelect.innerHTML = '<option value="">Select Equipment...</option>' + items.map(i => `<option value="${i.id}">${i.item_name} (SN: ${i.serial_no})</option>`).join('');
}

async function reportIssue() {
    const lab_id = document.getElementById('issue-lab').value;
    const equipment_id = document.getElementById('issue-equip').value;
    const description = document.getElementById('issue-desc').value;
    
    if (!lab_id || !equipment_id || !description) return alert("Please fill all fields!");
    
    await fetchAPI('/issues', 'POST', { lab_id, equipment_id, description });
    alert("Issue Reported! The equipment status is now marked as 'Issue'.");
    
    document.getElementById('issue-equip').innerHTML = '<option value="">Select Equipment...</option>';
    document.getElementById('issue-lab').value = '';
    document.getElementById('issue-desc').value = '';
    loadIssues();
}

async function loadIssues() { 
    const d = await fetchAPI('/issues'); 
    if(document.getElementById('issue-list')) {
        document.getElementById('issue-list').innerHTML = d.map(x => `<tr>
            <td>${x.reporter_name}</td>
            <td>${x.Lab?.lab_name || 'N/A'}</td>
            <td>${x.Equipment?.item_name || 'N/A'} (${x.Equipment?.serial_no || ''})</td>
            <td>${x.description}</td>
            <td><b>${x.status}</b></td>
            <td>${x.status==='Open'?`<button class="btn" style="background:green" onclick="closeIssue(${x.id})">Mark Resolved</button>`:'✔'}</td>
        </tr>`).join(''); 
    }
}

async function closeIssue(id) { 
    await fetchAPI(`/issues/${id}/close`, 'PUT'); 
    alert("Issue resolved. Equipment status restored to 'Active'.");
    loadIssues(); 
}

// ==========================================
// 👥 USERS & LABS
// ==========================================
async function loadUsers() { 
    const d = await fetchAPI('/users'); 
    document.getElementById('user-list').innerHTML = d.map(x => `<tr><td>${x.name}</td><td>${x.role}</td><td><button class="delete-btn" onclick="delUser(${x.id})">Delete</button></td></tr>`).join(''); 
}
async function addUser() { 
    await fetchAPI('/users', 'POST', { name:document.getElementById('u-name').value, email:document.getElementById('u-email').value, password:document.getElementById('u-pass').value, role:document.getElementById('u-role').value }); 
    loadUsers(); 
}
async function delUser(id) { if(confirm('Delete user?')) { await fetchAPI(`/users/${id}`, 'DELETE'); loadUsers(); } }

async function loadLabs() { 
    const d = await fetchAPI('/labs'); 
    document.getElementById('lab-list').innerHTML = d.map(x => `<tr><td>${x.lab_name}</td><td>${x.location}</td><td><button class="delete-btn" onclick="delLab(${x.id})">Delete</button></td></tr>`).join(''); 
}
async function addLab() { 
    await fetchAPI('/labs', 'POST', { lab_name:document.getElementById('l-name').value, location:document.getElementById('l-loc').value }); 
    loadLabs(); 
}
async function delLab(id) { if(confirm('Delete Lab?')) { await fetchAPI(`/labs/${id}`, 'DELETE'); loadLabs(); } }


// ==========================================
// 🟢 STOCK LIST GENERATOR (UPDATED REMARKS LOGIC)
// ==========================================
async function loadStock() {
    try {
        const items = await fetchAPI('/equipments');
        const stockData = {}; 

        // 1. Group items and count them by Lab and Type
        items.forEach(item => {
            const labName = item.Lab ? item.Lab.lab_name : 'Unassigned';
            const type = item.type || 'Other';
            
            if (!stockData[labName]) stockData[labName] = {};
            // NEW: Track 'issues' instead of 'active'
            if (!stockData[labName][type]) stockData[labName][type] = { total: 0, issues: 0 };
            
            stockData[labName][type].total++;
            
            // NEW: Only count as broken if the status is explicitly 'Issue'
            if(item.status === 'Issue') stockData[labName][type].issues++;
        });

        // 2. Generate the HTML Tables
        let html = '';
        for (const [lab, types] of Object.entries(stockData)) {
            
            const safeLabId = 'stock-' + lab.replace(/[^a-zA-Z0-9]/g, '-');

            html += `
                <div id="${safeLabId}" class="lab-stock-container card" style="margin-bottom: 30px; background: white; padding: 20px; border-radius: 8px; box-sizing: border-box;">
                    <h3 style="text-align: center; margin-bottom: 20px; font-family: 'Times New Roman', serif; text-transform: uppercase; color: #333;">
                        INVENTORY LIST OF ${lab} EQUIPMENT
                    </h3>
                    
                    <table style="width: 100%; border-collapse: collapse; border: 1px solid black; font-family: 'Times New Roman', serif; color: black; margin-bottom: 15px; table-layout: fixed;">
                        <thead>
                            <tr style="background-color: #f2f2f2;">
                                <th style="border: 1px solid black; padding: 12px; width: 10%; text-align: center;">Sl No.</th>
                                <th style="border: 1px solid black; padding: 12px; width: 35%; text-align: left;">Name of Equipment</th>
                                <th style="border: 1px solid black; padding: 12px; width: 15%; text-align: center;">Quantity</th>
                                <th style="border: 1px solid black; padding: 12px; width: 15%; text-align: center;">Unit</th>
                                <th style="border: 1px solid black; padding: 12px; width: 25%; text-align: center;">Remarks</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            let slNo = 1;
            for (const [type, data] of Object.entries(types)) {
                // NEW: If 0 issues, it's "Functional". Otherwise, show exactly how many need repair.
                let remarks = data.issues === 0 ? 'Functional' : `${data.total - data.issues} Functional, ${data.issues} Needs Repair`;
                
                html += `
                            <tr>
                                <td style="border: 1px solid black; padding: 10px; text-align: center;">${slNo++}</td>
                                <td style="border: 1px solid black; padding: 10px; text-align: left; font-weight: bold;">${type}</td>
                                <td style="border: 1px solid black; padding: 10px; text-align: center;">${data.total}</td>
                                <td style="border: 1px solid black; padding: 10px; text-align: center;">pcs</td>
                                <td style="border: 1px solid black; padding: 10px; text-align: center; color: ${data.issues === 0 ? 'black' : '#dc3545'};">${remarks}</td>
                            </tr>
                `;
            }
            
            html += `
                        </tbody>
                    </table>
                    
                    <div class="no-print" style="text-align: right; margin-top: 15px;">
                        <button onclick="printLabStock('${safeLabId}')" class="btn" style="background: #28a745; color: white; padding: 10px 20px; font-weight: bold; border-radius: 5px; cursor: pointer; border: none;">
                            🖨️ Print ${lab} Stock
                        </button>
                    </div>
                </div>
            `;
        }
        
        document.getElementById('stock-list-container').innerHTML = html || '<p style="text-align: center; color: gray;">No equipment stock found.</p>';

    } catch (e) {
        console.error("Error loading stock:", e);
    }
}

// 🟢 NEW: Fixed Print Function to change the Browser Header!
function printLabStock(containerId) {
    // 1. Temporarily change the document title so the browser prints the correct header
    const originalTitle = document.title;
    document.title = "CEC Lab Management System"; 
    
    // 2. Isolate the table
    document.querySelectorAll('.lab-stock-container').forEach(el => el.classList.remove('print-active'));
    document.getElementById(containerId).classList.add('print-active');
    
    // 3. Print
    window.print();
    
    // 4. Change the title back to normal after the print dialog closes
    document.title = originalTitle;
}

// ==========================================
// 🛠️ UTILS & INITIALIZATION
// ==========================================
function downloadPDF() { 
    const labId = document.getElementById('report-lab') ? document.getElementById('report-lab').value : 'all';
    let url = `http://localhost:5000/api/reports/pdf?token=${token}`;
    if (labId !== 'all') url += `&lab_id=${labId}`; 
    window.open(url); 
}

function logout() { 
    localStorage.clear(); 
    location.href='index.html'; 
}

// Initialize Dashboard
show('home');