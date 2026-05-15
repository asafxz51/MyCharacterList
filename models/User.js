const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
 username: { type: String, required: true, unique: true },
 password: { type: String, required: true },
 following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
 role: { type: String, default: 'user' },
 avatar: { type: String, default: '' },
 banner: { type: String, default: '' }, 
 bio: { type: String, default: 'No bio written yet.' }, 
 featuredListId: { type: String, default: null }, 
 notifications: [{
  type: { type: String },
  fromUser: String,
  listId: mongoose.Schema.Types.ObjectId,
  listName: String,
  commentText: String,
  read: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
 }]
});

module.exports = mongoose.model('User', UserSchema);