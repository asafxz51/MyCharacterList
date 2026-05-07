const mongoose = require('mongoose');

const ListSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 name: { type: String, required: true },
 rankingType: { type: String, default: 'numbers' },
 isPrivate: { type: Boolean, default: false },
 isFreeOrder: { type: Boolean, default: false },
 allowComments: { type: Boolean, default: true }, 
 likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], 
 comments: [{
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: String,
  text: String,
  role: String,
  timestamp: { type: Date, default: Date.now }
 }],
 items: [{
  characterName: String,
  sourceTitle: String,
  sourceType: String,
  image: String,
  rating: Number,
  description: String
 }]
});

module.exports = mongoose.model('List', ListSchema);