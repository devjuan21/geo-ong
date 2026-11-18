const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  listConversations,
  getConversationMessages,
  sendConversationMessage,
  markConversationRead,
  getUnreadCount,
  archiveConversation,
  unarchiveConversation,
} = require('../controllers/messageController');

const router = express.Router();

router.use(authenticate);

router.get('/conversations', listConversations);
router.get('/conversations/:id/messages', getConversationMessages);
router.post('/conversations/:id/messages', sendConversationMessage);
router.post('/conversations/:id/read', markConversationRead);
router.patch('/conversations/:id/read', markConversationRead);
router.patch('/conversations/:id/archive', archiveConversation);
router.patch('/conversations/:id/unarchive', unarchiveConversation);
router.get('/unread-count', getUnreadCount);

module.exports = router;
