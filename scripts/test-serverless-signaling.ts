import {
  getRoomMessages,
  addRoomMessage,
  deleteRoom,
  validateRoomId,
} from '../src/lib/signaling';

async function runSignalingTests() {
  console.log('🧪 Starting Serverless Signaling Tests...\n');

  const roomId = 'test_room_' + Math.random().toString(36).substring(2, 8);
  const hostId = 'client-host-1';
  const guestId = 'client-guest-2';

  // 1. Validate room ID checks
  console.log('1. Testing Room ID Validation...');
  if (!validateRoomId(roomId)) throw new Error('Valid roomId was rejected');
  if (validateRoomId('../invalid/room')) throw new Error('Path traversal roomId was accepted');
  if (validateRoomId('room with spaces')) throw new Error('Spaces in roomId was accepted');
  if (validateRoomId('a'.repeat(65))) throw new Error('Overlong roomId was accepted');
  console.log('✅ Room ID validation passed');

  // 2. Initial state: room should be empty
  console.log('\n2. Checking initial room messages...');
  const initRes = await getRoomMessages(roomId, hostId, 0);
  if (!initRes.ok || initRes.messages.length !== 0) {
    throw new Error('Initial room was not empty');
  }
  console.log('✅ Initial room is empty');

  // 3. Host creates & posts Offer
  console.log('\n3. Host posts WebRTC Offer...');
  const offerMsg = { sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1...', type: 'offer' };
  const postOffer = await addRoomMessage(
    roomId,
    hostId,
    'offer',
    offerMsg,
    JSON.stringify(offerMsg).length
  );
  if (!postOffer.ok || !postOffer.id) {
    throw new Error('Host failed to post offer');
  }
  console.log(`✅ Host posted offer (id: ${postOffer.id})`);

  // 4. Host polls room: Host should NOT receive its own message
  const hostPoll = await getRoomMessages(roomId, hostId, 0);
  if (hostPoll.messages.length !== 0) {
    throw new Error('Host received its own message');
  }
  console.log('✅ Host correctly ignores own messages');

  // 5. Guest polls room: Guest receives the Offer
  console.log('\n4. Guest polls and retrieves Offer...');
  const guestPoll = await getRoomMessages(roomId, guestId, 0);
  if (guestPoll.messages.length !== 1 || guestPoll.messages[0].type !== 'offer') {
    throw new Error('Guest did not receive offer');
  }
  const offerTimestamp = guestPoll.messages[0].timestamp;
  console.log('✅ Guest received offer successfully');

  // 6. Guest posts Answer
  console.log('\n5. Guest posts WebRTC Answer...');
  const answerMsg = { sdp: 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1...', type: 'answer' };
  const postAnswer = await addRoomMessage(
    roomId,
    guestId,
    'answer',
    answerMsg,
    JSON.stringify(answerMsg).length
  );
  if (!postAnswer.ok || !postAnswer.id) {
    throw new Error('Guest failed to post answer');
  }
  console.log(`✅ Guest posted answer (id: ${postAnswer.id})`);

  // 7. Host polls since offerTimestamp: Host receives Answer
  console.log('\n6. Host polls for Answer...');
  const hostPollAnswer = await getRoomMessages(roomId, hostId, offerTimestamp);
  if (hostPollAnswer.messages.length !== 1 || hostPollAnswer.messages[0].type !== 'answer') {
    throw new Error('Host did not receive answer');
  }
  console.log('✅ Host received answer successfully');

  // 8. Trickle ICE candidate exchange
  console.log('\n7. Testing Trickle ICE candidate exchange...');
  const candidateHost = { candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 50000 typ host', sdpMid: '0' };
  await addRoomMessage(roomId, hostId, 'ice-candidate', candidateHost, JSON.stringify(candidateHost).length);

  const candidateGuest = { candidate: 'candidate:2 1 UDP 2130706431 192.168.1.2 50001 typ host', sdpMid: '0' };
  await addRoomMessage(roomId, guestId, 'ice-candidate', candidateGuest, JSON.stringify(candidateGuest).length);

  const guestIce = await getRoomMessages(roomId, guestId, postAnswer.timestamp!);
  const hostIce = await getRoomMessages(roomId, hostId, postAnswer.timestamp!);

  if (!guestIce.messages.some((m) => m.type === 'ice-candidate')) {
    throw new Error('Guest did not receive ICE candidate');
  }
  if (!hostIce.messages.some((m) => m.type === 'ice-candidate')) {
    throw new Error('Host did not receive ICE candidate');
  }
  console.log('✅ Bi-directional Trickle ICE exchange verified');

  // 9. Payload size limit check (> 64KB rejected)
  console.log('\n8. Testing Payload Size Protection (>64KB)...');
  const oversized = await addRoomMessage(
    roomId,
    hostId,
    'offer',
    { large: 'x'.repeat(70000) },
    70000
  );
  if (oversized.ok || oversized.status !== 413) {
    throw new Error('Oversized payload was not rejected with status 413');
  }
  console.log('✅ Oversized payload properly rejected with 413');

  // 10. Room deletion / cleanup
  console.log('\n9. Testing Room Deletion...');
  const delRes = await deleteRoom(roomId);
  if (!delRes.ok) throw new Error('Delete room failed');
  const afterDel = await getRoomMessages(roomId, hostId, 0);
  if (afterDel.messages.length !== 0) throw new Error('Room still had messages after delete');
  console.log('✅ Room cleanup verified');

  console.log('\n🎉 ALL SERVERLESS SIGNALING TESTS PASSED SUCCESSFULLY!\n');
}

runSignalingTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
