const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

// Models
const User = require('./models/User');
const List = require('./models/List');
const Settings = require('./models/Settings');
const Log = require('./models/Log');
const LeaderboardOverride = require('./models/LeaderboardOverride');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(cors());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Database Connection
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    isConnected = true;
    console.log("MongoDB Connected");
  } catch (err) { console.error("MongoDB Error:", err); }
};

app.use(async (req, res, next) => { await connectDB(); next(); });

// Middlewares
const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Access Denied' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) { res.status(400).json({ error: 'Invalid Token' }); }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admins Only' });
    next();
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

const optionalToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return next();
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); } catch (err) { next(); }
};

// Logging Helper
async function saveLog(user, action, details) {
  try {
    const log = new Log({
      userId: user ? user._id : null,
      username: user ? user.username : 'Guest',
      action,
      details
    });
    await log.save();
  } catch (e) { console.error("Log error:", e); }
}

// --- ADMIN: LEADERBOARD OVERRIDE EDIT ---
app.put('/api/admin/character/global-edit', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { oldCharId, characterName, sourceTitle, sourceType, image, isHidden } = req.body;

    await LeaderboardOverride.findOneAndUpdate(
      { charId: oldCharId },
      { characterName, sourceTitle, sourceType, image, isHidden },
      { upsert: true, new: true }
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// --- AUTH ROUTES ---

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing data' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    await saveLog(user, "User Registered", `New user: ${username}`);
    res.json({ message: 'User created' });
  } catch (err) { res.status(400).json({ error: "Username taken or invalid" }); }
});

app.post('/api/auth/login', async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  await saveLog(user, "User Login", "Logged into the system");
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }).json({ message: 'Logged in', username: user.username });
});

app.post('/api/auth/logout', (req, res) => res.clearCookie('token').json({ message: 'Logged out' }));

app.get('/api/auth/check', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({
      _id: user._id,
      username: user.username,
      role: user.role,
      avatar: user.avatar || '' 
    });
  } catch (e) { res.status(401).json({ error: "Unauthorized" }); }
});

app.post('/api/auth/ping', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) await saveLog(user, "Site Entry", "User accessed site (Session)");
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- LISTS & CHARACTERS ---

app.get('/api/lists', verifyToken, async (req, res) => {
  const lists = await List.find({ userId: req.user._id }).sort({ order: 1 });
  res.json(lists);
});

// --- USER SAVES A LIST (With Auto-Custom Linker by NAME ONLY) ---
app.post('/api/lists', verifyToken, async (req, res) => {
  try {
    const data = req.body;
    const user = await User.findById(req.user._id);

    const approvedCustoms = await LeaderboardOverride.find({ charId: { $regex: '^custom_' } });

    if (data.items && Array.isArray(data.items)) {
      data.items.forEach(item => {
        // הגנת ציונים
        if (item.rating > 10) item.rating = 10;
        if (item.rating < 0) item.rating = 0;

        const apiStr = item.apiId ? item.apiId.toString() : "";
        if (!apiStr || apiStr === "null" || apiStr === "undefined" || apiStr === "") {

          if (item.characterName) {
            // החיפוש פה בודק עכשיו *רק* את השם של הדמות!
            const matchedCustom = approvedCustoms.find(c =>
              c.characterName.toLowerCase().trim() === item.characterName.toLowerCase().trim()
            );

            if (matchedCustom) {
              item.apiId = matchedCustom.charId;
              item.entityType = 'character';
            }
          }
        }
      });
    }

    await saveLog(user, data.logAction || (data._id ? "Update" : "Create"), data.logDetails || data.name);
    data.scaleUpdated = true;

    if (data._id) {
      const updated = await List.findByIdAndUpdate(data._id, data, { new: true });
      return res.json(updated);
    }

    data.userId = req.user._id;
    data.allowComments = data.allowComments !== false;
    const newList = new List(data);
    await newList.save();

    return res.json(newList);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.delete('/api/lists/:id', verifyToken, async (req, res) => {
  try {
    const list = await List.findOne({ _id: req.params.id, userId: req.user._id });
    if (!list) return res.status(404).send("Not found");
    const user = await User.findById(req.user._id);
    await saveLog(user, "Delete List", `Deleted list: "${list.name}"`);
    await List.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).send(e.message); }
});

app.put('/api/lists/reorder', verifyToken, async (req, res) => {
  const { orderedIds } = req.body;
  const updates = orderedIds.map((id, index) => List.updateOne({ _id: id, userId: req.user._id }, { order: index }));
  await Promise.all(updates);
  res.json({ success: true });
});

app.post('/api/lists/:id/duplicate', verifyToken, async (req, res) => {
  const original = await List.findOne({ _id: req.params.id, userId: req.user._id });
  const newList = new List({ userId: req.user._id, name: original.name + " (Copy)", items: original.items, rankingType: original.rankingType, isPrivate: original.isPrivate });
  await newList.save();
  const user = await User.findById(req.user._id);
  await saveLog(user, "Duplicate List", `From: ${original.name}`);
  res.json(newList);
});

// --- GLOBAL LEADERBOARD (OPTIMIZED & LIGHTWEIGHT WITH SORTING) ---
app.get('/api/leaderboard', async (req, res) => {
  try {
    // 1. בודק איך ביקשנו למיין
    const sortParam = req.query.sort;
    const sortStage = sortParam === 'popularity'
      ? { rankedByCount: -1, avgRating: -1 } // קודם כמות מדרגים, אח"כ ציון
      : { avgRating: -1, rankedByCount: -1 }; // קודם ציון, אח"כ כמות מדרגים

    const pipeline = [
      // { $match: { isPrivate: { $ne: true } } },
      { $project: { userId: 1, items: 1 } },
      { $unwind: "$items" },
      {
        $match: {
          "items.rating": { $gt: 0 },
          "items.apiId": { $nin: [null, "", "null", "undefined"] },
          "items.entityType": { $ne: "series" }
        }
      },
      {
        $addFields: {
          charId: { $toString: "$items.apiId" }
        }
      },
      {
        $group: {
          _id: { userId: "$userId", charId: "$charId" },
          maxRating: { $max: "$items.rating" },
          characterName: { $first: "$items.characterName" },
          sourceTitle: { $first: "$items.sourceTitle" },
          sourceType: { $first: "$items.sourceType" },
          image: { $max: "$items.image" }
        }
      },
      {
        $group: {
          _id: "$_id.charId",
          characterName: { $first: "$characterName" },
          sourceTitle: { $first: "$sourceTitle" },
          sourceType: { $first: "$sourceType" },
          image: { $max: "$image" },
          avgRating: { $avg: "$maxRating" },
          rankedByCount: { $sum: 1 }
        }
      },
      { $match: { rankedByCount: { $gte: 2 } } },
      { $sort: sortStage }, // <--- הזרקת המיון שבחרנו כאן!
      { $limit: 100 }
    ];

    const leaderboardRaw = await List.aggregate(pipeline);

    const overrides = await LeaderboardOverride.find({});
    const overrideMap = {};
    overrides.forEach(o => { overrideMap[o.charId] = o; });

    const finalLeaderboard = leaderboardRaw.map(item => {
      const override = overrideMap[item._id];
      if (override) {
        if (override.isHidden) return null;
        item.characterName = override.characterName || item.characterName;
        item.sourceTitle = override.sourceTitle || item.sourceTitle;
        item.sourceType = override.sourceType || item.sourceType;
        item.image = override.image || item.image;
      }
      return item;
    }).filter(item => item !== null);

    res.json(finalLeaderboard);
  } catch (e) {
    console.error("Leaderboard Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// --- NEW: GET SPECIFIC CHARACTER VOTERS ---
app.get('/api/leaderboard/voters/:charId', async (req, res) => {
  try {
    const charId = req.params.charId;

    // משיכת הרשימות שבהן הדמות מופיעה
    const lists = await List.find({ isPrivate: { $ne: true }, "items.apiId": charId })
      .populate('userId', 'username avatar');

    const userBestRating = {};

    lists.forEach(list => {
      if (!list.userId) return;
      const user = list.userId;

      list.items.forEach(item => {
        if (item.apiId && item.apiId.toString() === charId && item.rating > 0) {
          const currentMax = userBestRating[user._id] ? userBestRating[user._id].rating : 0;
          if (item.rating > currentMax) {
            userBestRating[user._id] = {
              username: user.username,
              avatar: user.avatar,
              rating: item.rating
            };
          }
        }
      });
    });

    // מיון המצביעים מהציון הגבוה לנמוך
    const voters = Object.values(userBestRating).sort((a, b) => b.rating - a.rating);
    res.json(voters);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Profile Picture ---

// עדכון תמונת פרופיל בלבד
app.put('/api/users/avatar', verifyToken, async (req, res) => {
  try {
    const { avatar } = req.body;
    const userId = req.user._id;

    // 1. עדכון המשתמש עצמו - זה מהיר מאוד!
    const user = await User.findByIdAndUpdate(userId, { avatar }, { new: true });

    // 2. שליחת תגובה מיידית למשתמש כדי שלא יקבל הודעת שגיאה
    res.json({ success: true, avatar: user.avatar });

    // 3. הרצת הסנכרון הכבד ברקע (בלי 'await' לפני ה-res)
    // זה מבטיח שהמשתמש יראה הצלחה, והשרת ימשיך לעדכן את התגובות בשקט
    saveLog(user, "Avatar Updated", "Background sync started");

    // מעדכנים תגובות וריפלייז ללא await שיעצור את התשובה
    List.find().then(lists => {
      lists.forEach(async (list) => {
        let listChanged = false;
        if (list.comments) {
          list.comments.forEach(c => {
            if (c.userId && c.userId.toString() === userId.toString()) {
              c.avatar = avatar;
              listChanged = true;
            }
            if (c.replies) {
              c.replies.forEach(r => {
                if (r.userId && r.userId.toString() === userId.toString()) {
                  r.avatar = avatar;
                  listChanged = true;
                }
              });
            }
          });
        }
        if (listChanged) await list.save();
      });
    });

  } catch (e) {
    console.error("Avatar save error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: "Server Error" });
    }
  }
});



// --- INTERACTIONS (LIKES/COMMENTS) ---


app.post('/api/lists/:id/like', verifyToken, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "List not found" });

    const userId = req.user._id.toString(); // ה-ID של המשתמש שעושה לייק
    const owner = await User.findById(list.userId);

    // הפיכת כל הלייקים הקיימים לטקסט כדי לבדוק בקלות
    const stringLikes = list.likes.map(id => id.toString());
    const index = stringLikes.indexOf(userId);
    let isLiked = false;

    if (index === -1) {
      // הוספת לייק
      list.likes.push(req.user._id);
      isLiked = true;

      // בדיקה אם המשתמש הוא לא בעל הרשימה
      if (owner && list.userId.toString() !== userId) {
        const userWhoLiked = await User.findById(req.user._id);

        // הגנה מספאם: האם כבר קיימת התראה על לייק לליסט הזה מהמשתמש הזה?
        const alreadyNotified = owner.notifications && owner.notifications.find(n =>
          n.type === 'like' &&
          n.fromUser === userWhoLiked.username &&
          n.listId.toString() === list._id.toString()
        );

        if (!alreadyNotified) {
          owner.notifications.unshift({
            type: 'like',
            fromUser: userWhoLiked.username,
            listId: list._id,
            listName: list.name,
            read: false,
            timestamp: new Date()
          });
          await owner.save();
        }
      }
      await saveLog(await User.findById(req.user._id), "Like List", `Liked: ${list.name}`);
    } else {
      // הסרת לייק
      list.likes.splice(index, 1);
      isLiked = false;
    }

    await list.save();
    res.json({ likesCount: list.likes.length, isLiked: isLiked });
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.post('/api/lists/:id/comment', verifyToken, async (req, res) => {
  try {
    const { text } = req.body;
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "List not found" });
    if (!list.allowComments) return res.status(403).json({ error: "Comments are disabled for this list." });

    const user = await User.findById(req.user._id);

    // מוצאים את כל התגובות של המשתמש הספציפי ברשימה הזו
    const userComments = list.comments.filter(c => c.userId && c.userId.toString() === user._id.toString());

    if (userComments.length > 0) {
      // התגובה האחרונה שהמשתמש שלח
      const lastComment = userComments[userComments.length - 1];
      const now = new Date();
      const lastTime = new Date(lastComment.timestamp);
      const diffInSeconds = (now - lastTime) / 1000;

      if (diffInSeconds < 30) {
        const waitTime = Math.ceil(30 - diffInSeconds);
        return res.status(429).json({
          error: `Please wait ${waitTime} seconds before posting another comment.`
        });
      }
    }

    const owner = await User.findById(list.userId);
    list.comments.push({ userId: user._id, username: user.username, avatar: user.avatar, text, role: user.role });
    await list.save();

    if (owner && list.userId.toString() !== user._id.toString()) {
      owner.notifications.unshift({
        type: 'comment',
        fromUser: user.username,
        listId: list._id,
        listName: list.name,
        commentText: text
      });
      await owner.save();
    }

    await saveLog(user, "Comment Added", `On list: ${list.name}`);
    res.json(list.comments);
  } catch (e) {
    res.status(500).json({ error: "Server Error" });
  }
});

app.post('/api/lists/:listId/comments/:commentId/like', verifyToken, async (req, res) => {
  try {
    const list = await List.findById(req.params.listId);
    const comment = list.comments.id(req.params.commentId);
    const user = await User.findById(req.user._id);
    const author = await User.findById(comment.userId);

    const index = comment.likes.indexOf(user._id);
    if (index === -1) {
      comment.likes.push(user._id);

      // בדיקה אם לשלוח התראה
      if (author && comment.userId.toString() !== user._id.toString()) {
        // הגנה: בודקים אם קיימת התראה מסוג לייק לתגובה *הספציפית הזו* (לפי ID)
        const alreadyNotified = author.notifications.find(n =>
          n.type === 'comment_like' &&
          n.fromUser === user.username &&
          n.commentText === comment._id.toString()
        );

        if (!alreadyNotified) {
          author.notifications.unshift({
            type: 'comment_like',
            fromUser: user.username,
            listId: list._id,
            listName: list.name,
            commentText: comment._id.toString() 
          });
          await author.save();
        }
      }
    } else {
      comment.likes.splice(index, 1);
    }
    await list.save();
    res.json(list.comments);
  } catch (e) { res.status(500).send(e.message); }
});

app.delete('/api/lists/:listId/comments/:commentId', verifyToken, async (req, res) => {
  try {
    const list = await List.findById(req.params.listId);
    const user = await User.findById(req.user._id);
    const comment = list.comments.id(req.params.commentId);

    if (!comment) return res.status(404).send("Comment not found");

    // בדיקת הרשאות מורחבת:
    // מותר למחוק אם: אתה האדמין OR אתה בעל הרשימה OR אתה זה שכתב את התגובה
    const isAdmin = user.role === 'admin';
    const isListOwner = list.userId.toString() === user._id.toString();
    const isCommentAuthor = comment.userId.toString() === user._id.toString();

    if (!isAdmin && !isListOwner && !isCommentAuthor) {
      return res.status(403).json({ error: "You can only delete your own comments or comments on your lists" });
    }

    list.comments.pull(req.params.commentId);
    await list.save();
    await saveLog(user, "Comment Deleted", `From list: ${list.name}`);
    res.json({ success: true });
  } catch (e) { res.status(500).send(e.message); }
});

// מחיקת תגובה לתגובה (Delete Reply)
app.delete('/api/lists/:listId/comments/:commentId/replies/:replyId', verifyToken, async (req, res) => {
  try {
    const list = await List.findById(req.params.listId);
    const comment = list.comments.id(req.params.commentId);
    if (!comment) return res.status(404).send("Comment not found");

    const reply = comment.replies.id(req.params.replyId);
    if (!reply) return res.status(404).send("Reply not found");

    const user = await User.findById(req.user._id);

    // בדיקת הרשאות מורחבת
    const isAdmin = user.role === 'admin';
    const isListOwner = list.userId.toString() === user._id.toString();
    const isReplyAuthor = reply.userId.toString() === user._id.toString();

    if (!isAdmin && !isListOwner && !isReplyAuthor) {
      return res.status(403).json({ error: "Unauthorized deletion" });
    }

    // הסרת הריפליי מהמערך
    comment.replies.pull(req.params.replyId);
    await list.save();

    await saveLog(user, "Delete Reply", `From list: ${list.name}`);
    res.json(list.comments); // מחזירים את המערך המעודכן
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// --- NOTIFICATIONS ---

app.get('/api/notifications', verifyToken, async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json(user.notifications || []);
});

app.post('/api/notifications/read', verifyToken, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $set: { "notifications.$[].read": true } });
  res.json({ success: true });
});

// --- COMMUNITY ---

app.get('/api/users', optionalToken, async (req, res) => {
  try {
    const { search } = req.query;
    // 1. מוצאים רק משתמשים שיש להם רשימות (כפי שביקשת קודם)
    const validUsersIds = await List.distinct('userId', { isPrivate: false, items: { $not: { $size: 0 } } });

    let query = { _id: { $in: validUsersIds } };
    if (search) query.username = { $regex: search, $options: 'i' };

    // 2. שליפת הנתונים - קריטי להוסיף avatar!
    const users = await User.find(query, 'username avatar');

    const currentUser = req.user ? await User.findById(req.user._id) : null;

    // 3. עיבוד נתונים לשליחה
    const results = users.map(u => ({
      _id: u._id,
      username: u.username,
      avatar: u.avatar || "", // מוודא שאם זה null זה יחזור כמחרוזת ריקה
      isFollowing: currentUser ? currentUser.following.includes(u._id) : false
    })).filter(u => !currentUser || u._id.toString() !== currentUser._id.toString());

    // 4. מיון
    results.sort((a, b) => (a.isFollowing === b.isFollowing ? 0 : a.isFollowing ? -1 : 1));

    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/follow/:id', verifyToken, async (req, res) => {
  const targetId = req.params.id;
  const user = await User.findById(req.user._id);
  const targetUser = await User.findById(targetId);
  const index = user.following.indexOf(targetId);
  if (index === -1) {
    user.following.push(targetId);
    if (targetUser) targetUser.notifications.unshift({ type: 'follow', fromUser: user.username });
    await targetUser?.save();
  } else { user.following.splice(index, 1); }
  await user.save();
  res.json(user.following);
});

app.get('/api/users/:userId/lists', async (req, res) => {
  const lists = await List.find({ userId: req.params.userId, isPrivate: { $ne: true } });
  res.json(lists);
});

// --- ADMIN ---

app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
  const users = await User.find({}, '-password');
  res.json(users);
});

app.delete('/api/admin/users/:id', verifyToken, verifyAdmin, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  await List.deleteMany({ userId: req.params.id });
  res.json({ success: true });
});

app.delete('/api/admin/lists/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "List not found" });

    const adminUser = await User.findById(req.user._id);
    await saveLog(adminUser, "Admin Deleted List", `Deleted list "${list.name}" (Owner ID: ${list.userId})`);

    await List.findByIdAndDelete(req.params.id);

    res.json({ success: true });
  } catch (e) {
    console.error("Admin Delete List Error:", e);
    res.status(500).json({ error: e.message });
  }
});


app.post('/api/admin/users/:id/reset', verifyToken, verifyAdmin, async (req, res) => {
  const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
  await User.findByIdAndUpdate(req.params.id, { password: hashedPassword });
  res.json({ success: true });
});

app.get('/api/admin/logs', verifyToken, verifyAdmin, async (req, res) => {
  const logs = await Log.find().sort({ timestamp: -1 }).limit(200);
  res.json(logs);
});

app.get('/api/admin/users/:id/lists', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const lists = await List.find({ userId: req.params.id });
    res.json(lists);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tmdb/credits', async (req, res) => {
  try {
    const { type, id } = req.query;
    if (!type || !id) return res.json([]);
    const r = await axios.get(`https://api.themoviedb.org/3/${type}/${id}/credits`, {
      params: { api_key: process.env.TMDB_API_KEY }
    });
    const cast = r.data.cast.slice(0, 15).map(c => ({
      characterName: c.character,
      actorName: c.name,
      image: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null
    }));
    res.json(cast);
  } catch (e) { res.json([]); }
});

app.get('/api/search/jikan', async (req, res) => {
  try {
    await new Promise(r => setTimeout(r, 500));
    const r = await axios.get(`https://api.jikan.moe/v4/characters`, { params: { q: req.query.query, limit: 15 } });
    res.json(r.data.data.map(i => ({
      id: i.mal_id, title: i.name, image: i.images?.jpg?.image_url, type: 'character', description: 'Anime Character'
    })));
  } catch (e) { res.json([]); }
});

app.get('/api/jikan/details/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`Fetching Jikan Details for ID: ${id}...`);

    const response = await axios.get(`https://api.jikan.moe/v4/characters/${id}/full`);
    const data = response.data.data;

    let sourceTitle = '';
    let sourceType = 'Anime';

    if (data.anime && data.anime.length > 0) {
      sourceTitle = data.anime[0]?.anime?.title;
      sourceType = 'Anime';
    }

    else if (data.manga && data.manga.length > 0) {
      sourceTitle = data.manga[0]?.manga?.title;
      sourceType = 'Manga';
    }

    if (!sourceTitle) {
      sourceTitle = '';
    }

    console.log(`Success: ${sourceTitle} (${sourceType})`);
    res.json({ sourceTitle, sourceType });

  } catch (e) {
    console.error("Jikan Error:", e.message);
    res.json({ sourceTitle: '', sourceType: 'Anime' });
  }
});

app.get('/api/image-proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('No URL');

    const response = await axios.get(url, { responseType: 'arraybuffer' });

    res.set('Content-Type', 'image/jpeg');
    res.send(response.data);
  } catch (e) {
    res.status(404).send('Image not found');
  }
});

app.get('/api/search/fandom', async (req, res) => {
  try {
    const { query } = req.query;

    const searchWiki = async (subdomain) => {
      const apiUrl = `https://${subdomain}.fandom.com/api.php`;

      const searchRes = await axios.get(apiUrl, {
        params: { action: 'query', list: 'search', srsearch: query, srlimit: 4, format: 'json' }
      });
      if (!searchRes.data.query) return [];
      const pageIds = searchRes.data.query.search.map(i => i.pageid).join('|');
      if (!pageIds) return [];

      const detailsRes = await axios.get(apiUrl, {
        params: {
          action: 'query',
          pageids: pageIds,
          prop: 'pageimages|extracts|categories',
          pithumbsize: 600,
          exchars: 200,
          exintro: true,
          explaintext: true,
          cllimit: 20,
          format: 'json'
        }
      });

      const pages = detailsRes.data.query.pages;

      return Object.values(pages).map(p => {
        let detectedSource = "";

        if (p.categories) {
          const validCats = p.categories.filter(c =>
            !c.title.includes("Males") &&
            !c.title.includes("Females") &&
            !c.title.includes("Articles") &&
            !c.title.includes("living") &&
            !c.title.includes("deceased")
          );

          const bestCat = validCats.find(c =>
            c.title.match(/(Characters|Villains|Heroes|Antagonists|Protagonists)/i)
          );

          if (bestCat) {
            detectedSource = bestCat.title
              .replace("Category:", "")
              .replace(/ Characters/i, "")
              .replace(/ Villains/i, "")
              .replace(/ Heroes/i, "")
              .replace(/ Antagonists/i, "")
              .replace(/ Protagonists/i, "")
              .trim();
          }
        }

        let rawImageUrl = p.thumbnail ? p.thumbnail.source : (p.original ? p.original.source : null);
        let proxyUrl = null;

        if (rawImageUrl) {
          proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(rawImageUrl)}`;
        }

        return {
          id: p.pageid,
          title: p.title,
          image: proxyUrl,
          type: 'wiki_character',
          sourceTitle: detectedSource,
          description: p.extract || '',
          wiki: subdomain
        };
      });
    };

    const [heroes, villains] = await Promise.all([
      searchWiki('heroes'),
      searchWiki('villains')
    ]);

    res.json([...heroes, ...villains]);
  } catch (e) {
    console.error("Fandom Error:", e.message);
    res.json([]);
  }
});

let igdbToken = null;
let tokenExpiresAt = 0;

async function getIgdbToken() {
  if (igdbToken && Date.now() < tokenExpiresAt) return igdbToken;

  try {
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_SECRET,
        grant_type: 'client_credentials'
      }
    });
    igdbToken = response.data.access_token;
    tokenExpiresAt = Date.now() + (response.data.expires_in * 1000);
    return igdbToken;
  } catch (e) {
    console.error("Twitch Token Error:", e.message);
    return null;
  }
}

app.get('/api/search/igdb', async (req, res) => {
  try {
    const token = await getIgdbToken();
    if (!token) return res.json([]);

    // IGDB uses a weird text-based query format
    const response = await axios.post('https://api.igdb.com/v4/characters',
      `search "${req.query.query}"; fields name, mug_shot.image_id; limit 10;`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      }
    );

    const results = response.data.map(item => ({
      id: item.id,
      title: item.name,
      image: item.mug_shot ? `https://images.igdb.com/igdb/image/upload/t_720p/${item.mug_shot.image_id}.jpg` : null,
      type: 'game_character',
      description: 'Video Game Character'
    }));

    res.json(results);
  } catch (e) {
    console.error("IGDB Search Error:", e.message);
    res.json([]);
  }
});

app.get('/api/igdb/details/:id', async (req, res) => {
  try {
    const token = await getIgdbToken();
    const { id } = req.params;

    const response = await axios.post('https://api.igdb.com/v4/characters',
      `where id = ${id}; fields name, games.name;`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      }
    );


    const data = response.data[0];
    let sourceTitle = '';

    if (data.games && data.games.length > 0) {
      sourceTitle = data.games[0].name;
    }

    res.json({ sourceTitle, sourceType: 'Game' });

  } catch (e) {
    console.error("IGDB Details Error:", e.message);
    res.json({ sourceTitle: '', sourceType: 'Game' });
  }
});

// --- SETTINGS ---
app.get('/api/settings/welcome', async (req, res) => {
  const s = await Settings.findOne({ key: 'global' });
  res.json(s || { welcomeTitle: 'Welcome', welcomeText: 'Hello!' });
});

app.post('/api/admin/settings/welcome', verifyToken, verifyAdmin, async (req, res) => {
  await Settings.findOneAndUpdate({ key: 'global' }, { welcomeTitle: req.body.title, welcomeText: req.body.text }, { upsert: true });
  res.json({ success: true });
});

app.get('/api/share/:id', async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: 'Not found' });
    const user = await User.findById(list.userId);

    // יצירת אובייקט עם הגנות על שדות של רשימות ישנות
    const listObj = list.toObject();
    const dataToSend = {
      ...listObj,
      author: user ? user.username : 'Unknown',
      likes: listObj.likes || [],
      comments: listObj.comments || [],
      allowComments: listObj.allowComments !== undefined ? listObj.allowComments : true
    };

    res.json(dataToSend);
  } catch (err) {
    console.error("Share list error:", err);
    res.status(404).json({ error: 'Not found' });
  }
});


// תגובה לתגובה
// תגובה לתגובה (Reply) - מתוקן
app.post('/api/lists/:listId/comments/:commentId/reply', verifyToken, async (req, res) => {
  try {
    const { text, replyingTo } = req.body;
    const list = await List.findById(req.params.listId);
    const comment = list.comments.id(req.params.commentId);
    const user = await User.findById(req.user._id);

    // הגבלת 30 שניות
    const lastR = comment.replies.filter(r => r.userId?.toString() === user._id.toString()).pop();
    if (lastR && (Date.now() - new Date(lastR.timestamp)) / 1000 < 30) {
      return res.status(429).json({ error: "Wait 30 seconds" });
    }

    comment.replies.push({ userId: user._id, username: user.username, avatar: user.avatar, text, role: user.role, replyingTo });
    await list.save();

    // התראה לבעל התגובה המקורית
    if (comment.userId.toString() !== user._id.toString()) {
      const author = await User.findById(comment.userId);
      author?.notifications.unshift({ type: 'reply', fromUser: user.username, listId: list._id, listName: list.name });
      await author?.save();
    }
    res.json(list.comments);
  } catch (e) { res.status(500).send(e.message); }
});

// לייק לתת-תגובה (Reply Like) - להוסיף כאן (היה חסר!)
app.post('/api/lists/:listId/comments/:commentId/replies/:replyId/like', verifyToken, async (req, res) => {
  try {
    const list = await List.findById(req.params.listId);
    const comment = list.comments.id(req.params.commentId);
    const reply = comment.replies.id(req.params.replyId);
    const user = await User.findById(req.user._id);
    const idx = reply.likes.indexOf(user._id);
    if (idx === -1) {
      reply.likes.push(user._id);
      if (reply.userId.toString() !== user._id.toString()) {
        const author = await User.findById(reply.userId);
        author?.notifications.unshift({ type: 'comment_like', fromUser: user.username, listId: list._id, listName: list.name });
        await author?.save();
      }
    } else { reply.likes.splice(idx, 1); }
    await list.save(); res.json(list.comments);
  } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/admin/fix-avatars', verifyToken, verifyAdmin, async (req, res) => {
  const users = await User.find();
  for (let u of users) {
    await List.updateMany({}, { $set: { "comments.$[elem].avatar": u.avatar } }, { arrayFilters: [{ "elem.userId": u._id }] });
    await List.updateMany({}, { $set: { "comments.$[].replies.$[repElem].avatar": u.avatar } }, { arrayFilters: [{ "repElem.userId": u._id }] });
  }
  res.send("All old avatars synced!");
});

app.get('/api/admin/rebuild-community', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await User.find();
    const lists = await List.find();
    let updatedListsCount = 0;

    for (let list of lists) {
      let listChanged = false;

      if (list.comments && Array.isArray(list.comments)) {
        list.comments.forEach(comment => {
          // מוצאים את המשתמש שכתב את התגובה
          const author = users.find(u => u._id.toString() === comment.userId?.toString());
          if (author && author.avatar) {
            comment.avatar = author.avatar;
            listChanged = true;
          }

          // בודקים אם יש ריפלייז ומרעננים גם אותם
          if (comment.replies && Array.isArray(comment.replies)) {
            comment.replies.forEach(reply => {
              const replyAuthor = users.find(u => u._id.toString() === reply.userId?.toString());
              if (replyAuthor && replyAuthor.avatar) {
                reply.avatar = replyAuthor.avatar;
                listChanged = true;
              }
            });
          }
        });
      }

      if (listChanged) {
        await list.save();
        updatedListsCount++;
      }
    }
    res.send(`Successfully updated avatars across ${updatedListsCount} lists.`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Sync Error: " + e.message);
  }
});

app.get('/api/admin/verify-users-data', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await User.find();
    let fixCount = 0;

    for (let user of users) {
      // אם השדה לא קיים או שהוא ריק, ניתן לו ערך ריק רשמי כדי שה-API יזהה אותו
      if (user.avatar === undefined) {
        user.avatar = "";
        await user.save();
        fixCount++;
      }
    }
    res.send(`Verification complete. Fixed ${fixCount} user records.`);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// נתיב זמני להזרקת נתוני דמה לבדיקת הלידרבורד
app.get('/api/admin/generate-dummies', verifyToken, verifyAdmin, async (req, res) => {
  try {
    // רשימת דמויות דמה שניתן להם ציונים שונים
    const dummyCharacters = [
      { name: "Super Mario", source: "Nintendo", apiId: "dummy_1", img: "https://placehold.co/150x150/252525/bb86fc?text=Mario" },
      { name: "Master Chief", source: "Halo", apiId: "dummy_2", img: "https://placehold.co/150x150/252525/bb86fc?text=Chief" },
      { name: "Pikachu", source: "Naruto", apiId: "dummy_3", img: "https://placehold.co/150x150/252525/bb86fc?text=Pika" },
      { name: "Kratos", source: "God of War", apiId: "dummy_4", img: "https://placehold.co/150x150/252525/bb86fc?text=Kratos" }
    ];

    let createdCount = 0;

    // יוצרים 3 משתמשים פיקטיביים
    for (let i = 1; i <= 3; i++) {
      const dummyUser = new User({
        username: `DummyTester_${i}_${Date.now().toString().slice(-4)}`,
        password: '123' // סיסמה סתמית, לא נשתמש בה
      });
      await dummyUser.save();

      // יוצרים רשימה לכל משתמש עם ציונים מוגרלים (בין 6 ל-10)
      const dummyList = new List({
        userId: dummyUser._id,
        name: `My Top Games (Dummy ${i})`,
        isPrivate: false, // חייב להיות ציבורי כדי להיכנס ללידרבורד!
        items: dummyCharacters.map(c => ({
          characterName: c.name,
          sourceTitle: c.source,
          sourceType: "Game",
          image: c.img,
          rating: Math.floor(Math.random() * 5) + 6, // ציון אקראי: 6, 7, 8, 9 או 10
          apiId: c.apiId,
          entityType: 'character' // חייב להיות character ולא series
        }))
      });
      await dummyList.save();
      createdCount++;
    }

    res.send(`<h1>Success!</h1><p>Created ${createdCount} dummy users and lists. Go back to the site and check the Leaderboard.</p>`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error: " + e.message);
  }
});

// --- ADMIN: FIX CORRUPTED CHARACTERS (DATABASE CLEANUP) ---
app.get('/api/admin/fix-corrupted-characters', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const lists = await List.find();
    let fixedNulls = 0;
    let fixedConflicts = 0;

    // שלב א: מיפוי המזהים כדי לגלות איזה מהם נדפקו מהבאג
    const idToNames = {};

    for (let list of lists) {
      list.items.forEach(item => {
        // ניקוי מזהים מזויפים שנשמרו כטקסט
        if (item.apiId === "null" || item.apiId === "undefined" || item.apiId === "") {
          item.apiId = null;
        }

        if (item.apiId) {
          const id = item.apiId.toString();
          if (!idToNames[id]) idToNames[id] = new Set();
          // שומרים את השם כדי לבדוק אחר כך אם יש כפילויות תחת אותו ID
          idToNames[id].add(item.characterName.trim().toLowerCase());
        }
      });
    }

    // מציאת המזהים שיש להם יותר משם אחד (זה אומר שהבאג קרה שם ואיחד דמויות שונות!)
    const corruptedIds = new Set();
    for (let id in idToNames) {
      if (idToNames[id].size > 1) {
        corruptedIds.add(id);
      }
    }

    // שלב ב: מעבר על כל הרשימות, מחיקת המזהים המקולקלים והחלת תיקונים
    for (let list of lists) {
      let modified = false;
      list.items.forEach(item => {
        // מחיקת טקסט "null" 
        if (item.apiId === "null" || item.apiId === "undefined" || item.apiId === "") {
          item.apiId = null;
          modified = true;
          fixedNulls++;
        }

        // מחיקת ID מקולקל! זה יכריח את הלידרבורד להשתמש בשם של הדמות במקום
        if (item.apiId && corruptedIds.has(item.apiId.toString())) {
          item.apiId = null;
          modified = true;
          fixedConflicts++;
        }

        // וידוא שיש לדמויות ישנות הגדרה כדי שלא יסוננו בטעות מהלידרבורד
        if (!item.entityType) {
          item.entityType = 'character';
          modified = true;
        }
      });

      if (modified) await list.save();
    }

    res.send(`
      <div style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #121212; color: white; height: 100vh;">
        <h1 style="color: #bb86fc; font-size: 3rem; margin-bottom: 20px;"><i class="fas fa-check-circle"></i> Database Cleaned!</h1>
        <div style="background: #252525; border: 1px solid #333; border-radius: 10px; padding: 20px; max-width: 600px; margin: 0 auto; font-size: 1.2rem; line-height: 1.8;">
            <p>Fixed <b>${fixedNulls}</b> false ID strings.</p>
            <p style="color: #ff4444;">Removed <b>${fixedConflicts}</b> corrupted IDs that caused characters to swap.</p>
            <p style="color: #4CAF50; margin-top: 20px;"><b>Result:</b> The leaderboard will now perfectly group old characters by their Name and Source.</p>
        </div>
        <button onclick="window.location.href='/'" style="padding: 15px 30px; background: #bb86fc; border: none; border-radius: 30px; color: #000; cursor: pointer; font-weight: bold; margin-top: 30px; font-size: 1.1rem;">Back to Home</button>
      </div>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error: " + e.message);
  }
});

// --- ADMIN: BRUTE FORCE REFRESH ALL CHARACTERS ---
app.get('/api/admin/refresh-all-characters', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const lists = await List.find();
    let listsUpdated = 0;
    let charactersFixed = 0;

    for (let list of lists) {
      // בניה מחדש של כל דמות ברשימה (בדיוק כמו הלחיצה בממשק)
      list.items = list.items.map(item => {
        let obj = item.toObject ? item.toObject() : item;

        // ניקוי מזהים
        if (obj.apiId === "null" || obj.apiId === "undefined" || obj.apiId === "") {
          obj.apiId = null;
        }

        // הבטחת טקסטים נקיים ללא רווחים נסתרים בקצוות (הסרת Whitespaces)
        obj.characterName = obj.characterName ? String(obj.characterName).trim() : "Unknown Character";
        obj.sourceTitle = obj.sourceTitle ? String(obj.sourceTitle).trim() : "Unknown Source";
        obj.sourceType = obj.sourceType || "Other";
        obj.entityType = obj.entityType || "character";
        obj.rating = Number(obj.rating) || 0;

        charactersFixed++;
        return obj;
      });

      // מסמנים למסד הנתונים ששינינו הכל ומכריחים אותו לשמור
      list.markModified('items');
      await list.save();
      listsUpdated++;
    }

    res.send(`
      <div style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #121212; color: white; height: 100vh;">
        <h1 style="color: #bb86fc; font-size: 3rem; margin-bottom: 20px;"><i class="fas fa-hammer"></i> Brute Force Refresh Complete!</h1>
        <div style="background: #252525; border: 1px solid #333; border-radius: 10px; padding: 30px; max-width: 600px; margin: 0 auto; font-size: 1.2rem; line-height: 1.8;">
            <p style="color: #4CAF50; font-size: 1.5rem;">Overwritten and saved <b>${listsUpdated}</b> lists.</p>
            <p>Forced clean data formats on <b>${charactersFixed}</b> characters.</p>
            <p style="color: #888; font-size: 1rem; margin-top: 15px;">All old characters have now been technically "updated" in the background.</p>
        </div>
        <button onclick="window.location.href='/'" style="padding: 15px 30px; background: #bb86fc; border: none; border-radius: 30px; color: #000; cursor: pointer; font-weight: bold; margin-top: 30px; font-size: 1.1rem;">Back to Home</button>
      </div>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error: " + e.message);
  }
});

// --- ADMIN: RESCUE OLD DATA (LEGACY ID GENERATOR) ---
app.get('/api/admin/rescue-old-data', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const lists = await List.find();
    let listsUpdated = 0;
    let charactersRescued = 0;

    for (let list of lists) {
      let isModified = false;

      list.items.forEach(item => {
        // אם לדמות אין apiId (כי היא נוצרה לפני השדרוג של האתר)
        if (!item.apiId || item.apiId === "null" || item.apiId === "undefined" || item.apiId === "") {

          const safeName = item.characterName ? item.characterName.trim().toLowerCase() : "unknown";
          const safeSource = item.sourceTitle ? item.sourceTitle.trim().toLowerCase() : "unknown";

          // מייצרים לה "תעודת זהות" וירטואלית כדי שהלידרבורד החדש יקבל אותה
          item.apiId = `legacy_${safeName}___${safeSource}`;

          isModified = true;
          charactersRescued++;
        }
      });

      if (isModified) {
        list.markModified('items');
        await list.save();
        listsUpdated++;
      }
    }

    res.send(`
      <div style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #121212; color: white; height: 100vh;">
        <h1 style="color: #bb86fc; font-size: 3rem; margin-bottom: 20px;"><i class="fas fa-life-ring"></i> Old Data Rescued!</h1>
        <div style="background: #252525; border: 1px solid #333; border-radius: 10px; padding: 30px; max-width: 600px; margin: 0 auto; font-size: 1.2rem; line-height: 1.8;">
            <p>We successfully generated Legacy API IDs for old characters.</p>
            <p style="color: #4CAF50; font-size: 1.5rem;">Updated <b>${listsUpdated}</b> lists.</p>
            <p>Rescued <b>${charactersRescued}</b> old characters.</p>
            <p style="color: #888; font-size: 1rem; margin-top: 15px;">Your leaderboard should now be full of your classic characters!</p>
        </div>
        <button onclick="window.location.href='/'" style="padding: 15px 30px; background: #bb86fc; border: none; border-radius: 30px; color: #000; cursor: pointer; font-weight: bold; margin-top: 30px; font-size: 1.1rem;">Back to Home</button>
      </div>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error: " + e.message);
  }
});

app.get('/api/admin/remove-legacy', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const lists = await List.find();
    let cleanedCharacters = 0;

    for (let list of lists) {
      let modified = false;
      list.items.forEach(item => {
        // אם לדמות יש מזהה מזויף שהתחלנו עם המילה legacy_
        if (item.apiId && item.apiId.toString().startsWith('legacy_')) {
          item.apiId = null; // מוחקים את המזהה המזויף כדי שתחזור להיות קאסטום
          modified = true;
          cleanedCharacters++;
        }
      });

      if (modified) {
        list.markModified('items');
        await list.save();
      }
    }

    res.send(`
      <div style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #121212; color: white;">
        <h1 style="color: #ff4444;"><i class="fas fa-trash"></i> Cleanup Complete!</h1>
        <p style="font-size: 1.2rem;">Removed fake legacy IDs from <b>${cleanedCharacters}</b> characters.</p>
        <p>The leaderboard is now strictly restricted to REAL API characters only.</p>
      </div>
    `);
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// פונקציית השהייה
const delay = ms => new Promise(res => setTimeout(res, ms));

const isExactMatch = (dbName, apiName) => {
  if (!dbName || !apiName) return false;
  const cleanDb = dbName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanApi = apiName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const reversedApi = apiName.toLowerCase().split(',').reverse().map(s => s.trim()).join('').replace(/[^a-z0-9]/g, '');
  return cleanDb === cleanApi || cleanDb === reversedApi;
};

// --- ADMIN: AUTO-MATCH IN BATCHES (Netlify Safe!) ---
app.get('/api/admin/auto-match-ids', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const lists = await List.find();
    let matchedCount = 0;
    const uniqueChars = new Map();

    // 1. איסוף הדמויות
    lists.forEach(list => {
      list.items.forEach(item => {
        const apiStr = item.apiId ? item.apiId.toString() : "";
        if (!apiStr || apiStr === "null" || apiStr === "undefined" || apiStr.startsWith('legacy_')) {
          const key = `${item.characterName.toLowerCase()}|||${item.sourceTitle}`;
          if (!uniqueChars.has(key)) {
            uniqueChars.set(key, { name: item.characterName, source: item.sourceTitle, foundId: null });
          }
        }
      });
    });

    const totalUnique = uniqueChars.size;

    // אם אין יותר מה לסרוק - סיימנו!
    if (totalUnique === 0) {
      return res.send(`
        <div style="font-family: Arial; padding: 40px; text-align: center; background: #121212; color: white; height:100vh;">
            <h1 style="color: #4CAF50;"><i class="fas fa-check-circle"></i> All Done!</h1>
            <p style="font-size: 1.2rem;">There are 0 characters left to scan.</p>
            <button onclick="window.location.href='/'" style="margin-top: 30px; padding: 10px 20px; cursor: pointer; background: #bb86fc; border: none; border-radius: 8px; font-weight: bold;">Back to Home</button>
        </div>
        `);
    }

    // לוקחים רק את ה-10 דמויות הראשונות! (כדי ש-Netlify לא יקרוס מ-Timeout)
    const chunk = Array.from(uniqueChars.entries()).slice(0, 10);
    const remaining = totalUnique - chunk.length;

    const PORT = process.env.PORT || 3000;
    const localBaseUrl = `http://127.0.0.1:${PORT}`;
    const safeFetch = async (endpoint) => {
      try {
        const r = await axios.get(`${localBaseUrl}${endpoint}`, { timeout: 4000 }); // טיימאאוט קצר של 4 שניות
        return Array.isArray(r.data) ? r.data : [];
      } catch (e) { return []; }
    };

    // 2. חיפוש (רק ל-10 הדמויות שבחרנו)
    for (let [key, charData] of chunk) {
      const cleanNameCheck = charData.name.replace(/[^a-zA-Z0-9א-ת]/g, '');
      if (!cleanNameCheck || cleanNameCheck.length === 0) continue;

      const query = encodeURIComponent(charData.name);
      try {
        const promises = [
          safeFetch(`/api/search/jikan?query=${query}`),
          safeFetch(`/api/search/igdb?query=${query}`),
          safeFetch(`/api/search/tmdb?query=${query}`),
          safeFetch(`/api/search/tmdb/person?query=${query}`),
          safeFetch(`/api/search/fandom?query=${query}`),
          safeFetch(`/api/search/rawg?query=${query}`),
          safeFetch(`/api/search/books?query=${query}`)
        ];

        const responses = await Promise.allSettled(promises);
        let combined = [];
        responses.forEach(r => { if (r.status === 'fulfilled') combined = combined.concat(r.value); });

        const exactMatch = combined.find(r => isExactMatch(charData.name, r.title));
        if (exactMatch) charData.foundId = exactMatch.id.toString();

      } catch (apiErr) { }
      await delay(1000);
    }

    // 3. שמירת ה-10 שסרקנו לדאטהבייס
    for (let list of lists) {
      let isModified = false;
      list.items.forEach(item => {
        const apiStr = item.apiId ? item.apiId.toString() : "";
        if (!apiStr || apiStr === "null" || apiStr === "undefined" || apiStr.startsWith('legacy_')) {
          const key = `${item.characterName.toLowerCase()}|||${item.sourceTitle}`;
          const mappedData = chunk.find(c => c[0] === key); // מחפשים רק בתוך המנה שלנו

          if (mappedData && mappedData[1].foundId) {
            item.apiId = mappedData[1].foundId;
            item.entityType = 'character';
            isModified = true;
            matchedCount++;
          } else if (mappedData) {
            // אם סרקנו ולא מצאנו, נסמן את זה כ"נכשל" כדי שלא נסרוק את זה שוב ושוב במנות הבאות
            item.apiId = "failed_match";
            isModified = true;
          }
        }
      });

      if (isModified) {
        list.markModified('items');
        await list.save();
      }
    }

    res.send(`
      <div style="font-family: Arial; padding: 40px; text-align: center; background: #121212; color: white; height:100vh;">
        <h1 style="color: #bb86fc;"><i class="fas fa-sync fa-spin"></i> Processing Batch...</h1>
        <div style="background: #252525; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto; line-height: 1.8;">
            <p>We just scanned <b>${chunk.length}</b> characters.</p>
            <p style="color: #4CAF50; font-size: 1.3rem;">Found exact matches for: <b>${matchedCount}</b></p>
            <hr style="border:1px solid #444; margin: 20px 0;">
            <p style="color: #ff9800; font-size: 1.5rem; font-weight:bold;">${remaining} Characters Remaining!</p>
            <p>Please refresh this page (F5) to process the next batch.</p>
        </div>
        <button onclick="window.location.reload()" style="margin-top: 30px; padding: 15px 30px; cursor: pointer; background: #bb86fc; border: none; border-radius: 8px; font-weight: bold; font-size: 1.1rem;">Scan Next 10 Characters</button>
      </div>
    `);
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

app.get('/api/admin/promote-custom-page', verifyToken, verifyAdmin, (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Approve Custom Character</title>
      <style>
        body { background: #121212; color: white; font-family: Arial; padding: 40px; display: flex; flex-direction: column; align-items: center; }
        .card { background: #252525; padding: 30px; border-radius: 12px; width: 100%; max-width: 500px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); border: 1px solid #333; }
        input { padding: 12px; margin: 10px 0 20px 0; width: 100%; box-sizing: border-box; background: #121212; border: 1px solid #444; color: white; border-radius: 6px; }
        button { padding: 12px; width: 100%; background: #bb86fc; border: none; font-weight: bold; cursor: pointer; border-radius: 6px; font-size: 1.1rem; }
        h2 { color: #bb86fc; margin-top: 0; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2><i class="fas fa-star"></i> Approve Custom Character</h2>
        <p style="color: #888; font-size: 0.9rem; margin-bottom: 20px;">The system will auto-link characters based <b>ONLY</b> on their Name.</p>
        <form action="/api/admin/promote-custom" method="POST">
          <label>Character Name (Used for matching users):</label>
          <input type="text" name="characterName" required placeholder="e.g. Mikasa Ackerman">
          
          <label>Source Title (Just for Leaderboard display):</label>
          <input type="text" name="sourceTitle" required placeholder="e.g. Attack on Titan">
          
          <button type="submit">Promote to Leaderboard</button>
        </form>
        <button onclick="window.location.href='/'" style="background: #444; color: white; margin-top: 15px;">Back to Home</button>
      </div>
    </body>
    </html>
  `);
});

app.post('/api/admin/promote-custom', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { characterName, sourceTitle } = req.body;

    // יצירת ID מבוסס *רק* על שם הדמות (הורדתי את הלוכסנים השגויים)
    const cleanName = characterName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const generatedId = `custom_${cleanName}`;

    await LeaderboardOverride.findOneAndUpdate(
      { charId: generatedId },
      { characterName: characterName.trim(), sourceTitle: sourceTitle.trim(), isHidden: false },
      { upsert: true, new: true }
    );

    const lists = await List.find();
    let updatedCount = 0;

    for (let list of lists) {
      let modified = false;
      list.items.forEach(item => {
        // חיפוש חופף שמבוסס נטו על שם הדמות!
        if (item.characterName &&
          item.characterName.toLowerCase().trim() === characterName.toLowerCase().trim()) {

          item.apiId = generatedId;
          item.entityType = 'character';
          modified = true;
        }
      });

      if (modified) {
        list.markModified('items');
        await list.save();
        updatedCount++;
      }
    }

    res.send(`
      <body style="background:#121212; color:white; font-family:Arial; text-align:center; padding:50px;">
        <h2 style="color:#4CAF50;">Success! Character Promoted!</h2>
        <p><b>${characterName}</b> was assigned ID: <br><span style="color:#bb86fc">${generatedId}</span></p>
        <p>Updated <b>${updatedCount}</b> past lists. All future users typing this name will get this ID regardless of the source they type.</p>
        <br><br>
        <a href="/api/admin/promote-custom-page" style="color:#bb86fc; font-size: 1.2rem; text-decoration: none; border: 1px solid #bb86fc; padding: 10px 20px; border-radius: 6px; margin-right: 10px;">Promote Another</a>
        <a href="/" style="color:#888; font-size: 1.2rem; text-decoration: none; border: 1px solid #888; padding: 10px 20px; border-radius: 6px;">Back Home</a>
      </body>
    `);
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// Netlify & Production setup
if (process.env.NODE_ENV !== 'production') {
  connectDB();
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

const serverless = require('serverless-http');
module.exports = app;
module.exports.handler = serverless(app);