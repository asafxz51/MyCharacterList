const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
 key: { type: String, default: 'global', unique: true },
 welcomeTitle: { type: String, default: 'Welcome to MyCharacterList' },
 welcomeText: { type: String, default: 'Create your ultimate character tier lists from Anime, Games, Movies, and TV Shows!\n\nRank your favorite characters, discover what other people are ranking in the community, and share your lists with friends.' }
});

module.exports = mongoose.model('Settings', SettingsSchema);