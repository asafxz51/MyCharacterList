const mongoose = require('mongoose');

const ListSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 name: { type: String, required: true },
 rankingType: { type: String, default: 'numbers' },
 isPrivate: { type: Boolean, default: false },
 order: { type: Number, default: 0 },
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