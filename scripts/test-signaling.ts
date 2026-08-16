async function testSignaling() {
  const roomId = 'test-room-' + Date.now();
  console.log(`Testing Signaling API for room: ${roomId}`);

  // 1. Host posts offer
  const hostMsg = {
    senderId: 'host-123',
    type: 'offer',
    data: { sdp: 'fake-sdp-offer', type: 'offer' },
  };

  const postRes = await fetch(`http://localhost:3000/api/signal/${roomId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hostMsg),
  });

  const postData = await postRes.json();
  if (!postData.ok) {
    console.error('❌ Failed to post offer', postData);
    process.exit(1);
  }
  console.log('✅ Host posted offer successfully');

  // 2. Guest polls and retrieves offer
  const getRes = await fetch(`http://localhost:3000/api/signal/${roomId}?senderId=guest-456&since=0`);
  const getData = await getRes.json();

  if (getData.messages?.length === 1 && getData.messages[0].type === 'offer') {
    console.log('✅ Guest received offer from host via signaling API');
  } else {
    console.error('❌ Guest failed to receive offer', getData);
    process.exit(1);
  }

  // 3. Guest posts answer
  const guestMsg = {
    senderId: 'guest-456',
    type: 'answer',
    data: { sdp: 'fake-sdp-answer', type: 'answer' },
  };

  await fetch(`http://localhost:3000/api/signal/${roomId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(guestMsg),
  });

  // 4. Host polls and retrieves answer
  const hostGetRes = await fetch(`http://localhost:3000/api/signal/${roomId}?senderId=host-123&since=0`);
  const hostGetData = await hostGetRes.json();

  if (hostGetData.messages?.length === 1 && hostGetData.messages[0].type === 'answer') {
    console.log('✅ Host received answer from guest via signaling API');
  } else {
    console.error('❌ Host failed to receive answer', hostGetData);
    process.exit(1);
  }

  console.log('\n🎉 ALL SIGNALING API TESTS PASSED!');
}

testSignaling().catch(console.error);
