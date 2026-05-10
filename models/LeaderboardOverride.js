const mongoose = require('mongoose');

const LeaderboardOverrideSchema = new mongoose.Schema({
 charId: { type: String, required: true, unique: true },
 characterName: String,
 sourceTitle: String,
 sourceType: String,
 image: String,
 isHidden: { type: Boolean, default: false } // השדה החדש שמאפשר באן לדמות
});

module.exports = mongoose.model('LeaderboardOverride', LeaderboardOverrideSchema);
