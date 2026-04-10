import express from 'express';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// Map to store active SSE connections: Map<userId, Set<response>>
const sseConnections = new Map();

router.get('/', verifyToken, (req, res) => {
  const userId = req.user.id;
  
  // Set up SSE response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Add this connection to the map
  if (!sseConnections.has(userId)) {
    sseConnections.set(userId, new Set());
  }
  sseConnections.get(userId).add(res);
  
  // Send initial heartbeat
  res.write(': heartbeat\n\n');
  
  // Send heartbeat every 30 seconds
  const heartbeatInterval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);
  
  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    const connections = sseConnections.get(userId);
    if (connections) {
      connections.delete(res);
      if (connections.size === 0) {
        sseConnections.delete(userId);
      }
    }
    res.end();
  });
});

export function broadcastSSE(userIds, event) {
  for (const userId of userIds) {
    const connections = sseConnections.get(userId);
    if (connections) {
      for (const res of connections) {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      }
    }
  }
}

export default router;
