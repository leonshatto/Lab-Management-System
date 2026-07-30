const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes, Op } = require('sequelize');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const xlsx = require('xlsx');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../frontend')));

const sequelize = new Sequelize('lab_management', 'root', '', { host: 'localhost', dialect: 'mysql', logging: false });

// --- MODELS ---
const User = sequelize.define('User', {
    name: { type: DataTypes.STRING }, email: { type: DataTypes.STRING, unique: true },
    password: { type: DataTypes.STRING }, role: { type: DataTypes.ENUM('Admin', 'Approver', 'LabStaff', 'Guest') }
});

const Lab = sequelize.define('Lab', { lab_name: { type: DataTypes.STRING }, location: { type: DataTypes.STRING } });

// NEW: Dynamic Equipment Types Model
const EquipmentType = sequelize.define('EquipmentType', {
    name: { type: DataTypes.STRING, unique: true }
}, { timestamps: false });

// UPDATED: Added Type and Price
const Equipment = sequelize.define('Equipment', {
    item_name: { type: DataTypes.STRING }, 
    type: { type: DataTypes.STRING }, // NEW
    price: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 }, // NEW
    serial_no: { type: DataTypes.STRING }, specs: { type: DataTypes.TEXT },
    supplier_info: { type: DataTypes.TEXT }, supplier_contact: { type: DataTypes.TEXT },
    purchase_date: { type: DataTypes.DATEONLY }, warranty_end: { type: DataTypes.DATEONLY },
    status: { type: DataTypes.STRING, defaultValue: 'Active' }, lab_id: { type: DataTypes.INTEGER }
});

const Transfer = sequelize.define('Transfer', {
    source_lab_id: { type: DataTypes.INTEGER }, dest_lab_id: { type: DataTypes.INTEGER },
    items: { type: DataTypes.JSON }, status: { type: DataTypes.ENUM('Pending', 'Approved', 'Rejected'), defaultValue: 'Pending' },
    requested_by: { type: DataTypes.INTEGER }
});

const Issue = sequelize.define('Issue', {
    reporter_name: { type: DataTypes.STRING }, description: { type: DataTypes.TEXT },
    status: { type: DataTypes.STRING, defaultValue: 'Open' }, lab_id: { type: DataTypes.INTEGER }, equipment_id: { type: DataTypes.INTEGER }
});

// --- ASSOCIATIONS ---
Lab.hasMany(Equipment, { foreignKey: 'lab_id' }); Equipment.belongsTo(Lab, { foreignKey: 'lab_id' });
Transfer.belongsTo(Lab, { as: 'SourceLab', foreignKey: 'source_lab_id' }); Transfer.belongsTo(Lab, { as: 'DestLab', foreignKey: 'dest_lab_id' });
Issue.belongsTo(Lab, { foreignKey: 'lab_id' }); 
Issue.belongsTo(Equipment, { foreignKey: 'equipment_id', onDelete: 'CASCADE' });
Equipment.hasMany(Issue, { foreignKey: 'equipment_id', onDelete: 'CASCADE' });

// --- MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization']; let token = authHeader && authHeader.split(' ')[1];
    if (!token) token = req.query.token; if (!token) return res.sendStatus(401);
    jwt.verify(token, 'secret_key', (err, user) => { if (err) return res.sendStatus(403); req.user = user; next(); });
};
const upload = multer({ dest: 'uploads/' });

// --- APIs ---

app.post('/api/auth/login', async (req, res) => { 
    const { username, password } = req.body; 
    const user = await User.findOne({ where: { name: username } }); 
    if (!user || user.password !== password) return res.status(403).send('Invalid Credentials'); 
    res.json({ token: jwt.sign({ id: user.id, role: user.role, name: user.name }, 'secret_key'), role: user.role, name: user.name }); 
});

// NEW APIs: Manage Equipment Types
app.get('/api/types', authenticateToken, async (req, res) => { res.json(await EquipmentType.findAll({ order: [['name', 'ASC']] })); });
app.post('/api/types', authenticateToken, async (req, res) => { 
    if(req.user.role !== 'Admin' && req.user.role !== 'LabStaff') return res.status(403).send('Unauthorized');
    try { await EquipmentType.create({ name: req.body.name }); res.json({ message: "Added" }); } 
    catch(e) { res.status(400).send("Type may already exist"); }
});
app.delete('/api/types/:id', authenticateToken, async (req, res) => { 
    if(req.user.role !== 'Admin' && req.user.role !== 'LabStaff') return res.status(403).send('Unauthorized');
    await EquipmentType.destroy({ where: { id: req.params.id } }); res.json({ message: "Deleted" }); 
});

app.get('/api/public/labs', async (req, res) => { res.json(await Lab.findAll()); });
app.get('/api/public/equipments', async (req, res) => { const wc = req.query.lab_id ? { lab_id: req.query.lab_id } : {}; res.json(await Equipment.findAll({ where: wc })); });
app.post('/api/public/issues', async (req, res) => { 
    await Issue.create(req.body); await Equipment.update({ status: 'Issue' }, { where: { id: req.body.equipment_id } }); res.json({ message: "Reported" }); 
});

app.get('/api/users', authenticateToken, async (req, res) => { res.json(await User.findAll()); }); 
app.post('/api/users', authenticateToken, async (req, res) => { await User.create(req.body); res.json({message:"Created"}); }); 
app.delete('/api/users/:id', authenticateToken, async (req, res) => { await User.destroy({where:{id:req.params.id}}); res.json({message:"Deleted"}); });

app.get('/api/labs', authenticateToken, async (req, res) => { res.json(await Lab.findAll()); }); 
app.post('/api/labs', authenticateToken, async (req, res) => { await Lab.create(req.body); res.json({ message: "Lab Created" }); }); 
app.delete('/api/labs/:id', authenticateToken, async (req, res) => { await Lab.destroy({ where: { id: req.params.id } }); res.json({ message: "Lab Deleted" }); });

// UPDATED: Equipment APIs now include type and price
app.get('/api/equipments', authenticateToken, async (req, res) => {
    const wc = req.query.lab_id ? { lab_id: req.query.lab_id } : {};
    const items = await Equipment.findAll({ where: wc, include: Lab, order: [['lab_id', 'ASC']] });
    res.json(items.map(item => {
        const i = item.toJSON(); i.age = new Date().getFullYear() - new Date(i.purchase_date).getFullYear();
        if (i.status === 'Issue') i.status = "Issue"; else if (i.age >= 15) i.status = "To Replace"; else if (new Date(i.warranty_end) < new Date()) i.status = "Warranty Expired"; else i.status = "Active";
        return i;
    }));
});

app.post('/api/equipments', authenticateToken, async (req, res) => { await Equipment.create(req.body); res.json({ message: "Item Added" }); });
app.delete('/api/equipments/:id', authenticateToken, async (req, res) => { await Equipment.destroy({ where: { id: req.params.id } }); res.json({ message: "Item Deleted" }); });

// UPDATED: Excel Import now looks for 'type' and 'price' columns
app.post('/api/equipments/import', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.body.lab_id) throw new Error("No Target Lab Selected");
        const data = xlsx.utils.sheet_to_json(xlsx.readFile(req.file.path, { cellDates: true }).Sheets[xlsx.readFile(req.file.path).SheetNames[0]]);
        for (let item of data) {
            await Equipment.create({
                item_name: item.item_name, type: item.type || 'Other', price: item.price || 0.00,
                serial_no: item.serial_no, specs: item.specs || 'N/A', supplier_info: item.supplier_info || 'N/A',
                supplier_contact: item.supplier_contact || 'N/A', purchase_date: new Date(item.purchase_date),
                warranty_end: new Date(item.warranty_end), lab_id: req.body.lab_id
            });
        }
        fs.unlinkSync(req.file.path); res.json({ message: "Import Successful" });
    } catch (e) { if (req.file) fs.unlinkSync(req.file.path); res.status(500).send(e.message); }
});

app.get('/api/issues', authenticateToken, async (req, res) => { res.json(await Issue.findAll({ include: [Lab, Equipment] })); });
app.post('/api/issues', authenticateToken, async (req, res) => { await Issue.create({ ...req.body, reporter_name: req.user.name }); await Equipment.update({ status: 'Issue' }, { where: { id: req.body.equipment_id } }); res.json({ message: "Reported" }); });
app.put('/api/issues/:id/close', authenticateToken, async (req, res) => { const issue = await Issue.findByPk(req.params.id); if(issue) { await issue.update({ status: 'Resolved' }); await Equipment.update({ status: 'Active' }, { where: { id: issue.equipment_id } }); } res.json({ message: "Resolved" }); });

app.get('/api/transfers', authenticateToken, async (req, res) => { res.json(await Transfer.findAll({ include: ['SourceLab', 'DestLab'] })); });
app.post('/api/transfers', authenticateToken, async (req, res) => { await Transfer.create({ ...req.body, requested_by: req.user.id }); res.json({ message: "Requested" }); });
app.put('/api/transfers/:id', authenticateToken, async (req, res) => {
    const { status } = req.body; const transfer = await Transfer.findByPk(req.params.id);
    if (status === 'Approved') { 
        let itemIds = transfer.items; if (typeof itemIds === 'string') { try { itemIds = JSON.parse(itemIds); } catch (e) { itemIds = []; } } 
        if (Array.isArray(itemIds) && itemIds.length > 0) { 
            const cleanIds = itemIds.map(id => parseInt(id)).filter(id => !isNaN(id)); 
            await Equipment.update({ lab_id: transfer.dest_lab_id }, { where: { id: { [Op.in]: cleanIds } } }); 
        } 
    }
    await transfer.update({ status }); res.json({ message: "Updated" });
});

app.get('/api/dashboard', authenticateToken, async (req, res) => { res.json({ totalLabs: await Lab.count(), totalEquip: await Equipment.count(), toReplace: await Equipment.count({ where: { purchase_date: { [Op.lte]: new Date(new Date().setFullYear(new Date().getFullYear() - 15)) } } }), warrantyExpired: await Equipment.count({ where: { warranty_end: { [Op.lte]: new Date() } } }) }); });

// UPDATED: PDF Generator with Statuses, Supplier Info, and Timestamps
app.get('/api/reports/pdf', authenticateToken, async (req, res) => {
    try {
        const doc = new PDFDocument({ margin: 40, size: 'A4' }); 
        res.setHeader('Content-disposition', 'attachment; filename="CEC_Lab_Report.pdf"'); 
        res.setHeader('Content-type', 'application/pdf'); 
        doc.pipe(res);
        
        const wc = req.query.lab_id && req.query.lab_id !== 'all' ? { lab_id: req.query.lab_id } : {};
        const equipments = await Equipment.findAll({ where: wc, include: Lab, order: [['lab_id', 'ASC']] });

        // 🟢 NEW: Generate exact current date and time
        const generatedTime = new Date().toLocaleString('en-IN', { 
            timeZone: 'Asia/Kolkata', 
            dateStyle: 'medium', 
            timeStyle: 'short' 
        });

        doc.fontSize(22).fillColor('#003366').text('CEC Lab Management System', { align: 'center' });
        doc.fontSize(16).fillColor('#333333').text('Complete Equipment Inventory', { align: 'center' }); 
        doc.fontSize(10).fillColor('gray').text(`Report Generated On: ${generatedTime}`, { align: 'center' }); // Added timestamp
        doc.moveDown(2);

        let currentLab = '';
        equipments.forEach(item => {
            const labName = item.Lab ? item.Lab.lab_name : 'Unassigned';
            if (labName !== currentLab) { 
                doc.moveDown(); 
                doc.fontSize(14).fillColor('#007bff').text(`Lab: ${labName}`, { underline: true }); 
                doc.moveDown(0.5); 
                currentLab = labName; 
            }
            
            // 🟢 NEW: Dynamic Status Calculation for the PDF
            const age = new Date().getFullYear() - new Date(item.purchase_date).getFullYear();
            let displayStatus = item.status;
            if (displayStatus !== 'Issue') {
                if (age >= 15) displayStatus = "To Replace";
                else if (new Date(item.warranty_end) < new Date()) displayStatus = "Warranty Expired";
                else displayStatus = "Active";
            }

            // Print Name, Type, Price
            doc.fontSize(11).fillColor('black').text(`• ${item.item_name} [${item.type}] (SN: ${item.serial_no}) - Price: Rs.${item.price}`);
            
            // Print Specs, Age, and the newly calculated Status
            doc.fontSize(9).fillColor('#555555').text(`   Specs: ${item.specs} | Age: ${age} yrs | Status: ${displayStatus}`);
            
            // 🟢 NEW: Print Supplier Information
            doc.fontSize(9).fillColor('#777777').text(`   Supplier: ${item.supplier_info} | Contact: ${item.supplier_contact}`);
            
            doc.moveDown(0.5);
        });
        doc.end(); 
    } catch (e) { res.status(500).send("Error generating PDF"); }
});

const init = async () => { 
    // This will add the new type and price columns to Equipment table and create EquipmentTypes
    await sequelize.sync({ alter: true }); 
    
    // Seed default dropdown options
    const defaults = ['CPU', 'Monitor', 'Mouse', 'Keyboard', 'Laptop', 'Printer', 'Projector', 'Hub', 'Switch', 'Modem'];
    for (let t of defaults) { await EquipmentType.findOrCreate({ where: { name: t } }); }

    if (!await User.findOne({ where: { name: 'admin' } })) {
        await User.create({ name: 'admin', email: 'admin@cec.ac.in', password: 'admin123', role: 'Admin' });
        await User.create({ name: 'labstaff', email: 'staff@cec.ac.in', password: 'staff123', role: 'LabStaff' });
    }
    app.listen(5000, () => console.log('Server running on port 5000')); 
}; 
init();