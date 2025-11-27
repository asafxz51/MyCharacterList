const mongoose = require('mongoose');

const ListSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 name: { type: String, required: true },
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