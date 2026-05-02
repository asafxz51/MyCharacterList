const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 username: String,
 action: String,   
 details: String,  
 timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Log', LogSchema);