const mongoose = require('mongoose');

const ListSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 name: { type: String, required: true },
 listDescription: { type: String, maxlength: 300 },
 order: { type: Number, default: 0 },
 rankingType: { type: String, default: 'numbers' },
 isPrivate: { type: Boolean, default: false },
 isFreeOrder: { type: Boolean, default: false },
 allowComments: { type: Boolean, default: true }, 
 scaleUpdated: { type: Boolean, default: false },
 likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], 
 comments: [{
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: String,
  avatar: String, 
  text: String,
  role: String,
  timestamp: { type: Date, default: Date.now },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  replies: [{
   userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
   username: String,
   avatar: String, 
   text: String,
   role: String,
   replyingTo: String,
   timestamp: { type: Date, default: Date.now },
   likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  }]
 }],
 
 items: [{
  characterName: String,
  sourceTitle: String,
  sourceType: String,
  image: String,
  rating: Number,
  description: String,
  notes: String,
  apiId: String,
  entityType: { type: String, default: 'character' }
 }]
});

ListSchema.index({ userId: 1 });
ListSchema.index({ isPrivate: 1 });
ListSchema.index({ "items.apiId": 1 });

module.exports = mongoose.model('List', ListSchema);