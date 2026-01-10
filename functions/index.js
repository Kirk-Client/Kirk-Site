// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.secret_key);
const axios = require('axios');

admin.initializeApp();

// Subscription tier mapping
const SUBSCRIPTION_MAP = {
  'Media Version': 'media',
  'KirkLite': 'lite',
  'Kirk Client': 'lifetime',
  'Merch': 'free'
};

// ============================================
// AUTO-CREATE USER DOCUMENT ON SIGNUP
// ============================================
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
  try {
    const userRef = admin.firestore().collection('users').doc(user.uid);
    
    // Check if document already exists (shouldn't happen, but just in case)
    const doc = await userRef.get();
    if (doc.exists) {
      console.log('⚠️ User document already exists for:', user.uid);
      return null;
    }
    
    // Extract username from email or displayName
    const username = user.displayName || user.email.split('@')[0];
    
    // Create user document with all required fields
    await userRef.set({
      uid: user.uid,
      username: username,
      email: user.email,
      hwid: 'N/A',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: admin.firestore.FieldValue.serverTimestamp(),
      accountStatus: 'active',
      subscriptionType: 'free',
      purchases: []
    });
    
    console.log('✅ User document auto-created for:', user.email, 'UID:', user.uid);
    return null;
  } catch (error) {
    console.error('❌ Error auto-creating user document:', error);
    // Don't throw error - let user creation succeed even if Firestore write fails
    return null;
  }
});

// ============================================
// CLEANUP: DELETE USER DOCUMENT ON ACCOUNT DELETION
// ============================================
exports.onUserDelete = functions.auth.user().onDelete(async (user) => {
  try {
    const userRef = admin.firestore().collection('users').doc(user.uid);
    await userRef.delete();
    
    console.log('✅ User document deleted for:', user.uid);
    return null;
  } catch (error) {
    console.error('❌ Error deleting user document:', error);
    return null;
  }
});

// ============================================
// FIX ALL EXISTING USERS WITHOUT DOCUMENTS
// ============================================
exports.fixExistingUsers = functions.https.onRequest(async (req, res) => {
  // Add CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const results = [];
    
    // Get all Firebase Auth users
    const listUsersResult = await admin.auth().listUsers();
    
    // Check each user
    for (const userRecord of listUsersResult.users) {
      const userRef = admin.firestore().collection('users').doc(userRecord.uid);
      const doc = await userRef.get();
      
      // If user document doesn't exist, create it
      if (!doc.exists) {
        const username = userRecord.displayName || userRecord.email.split('@')[0];
        
        await userRef.set({
          uid: userRecord.uid,
          username: username,
          email: userRecord.email,
          hwid: 'N/A',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastLogin: admin.firestore.FieldValue.serverTimestamp(),
          accountStatus: 'active',
          subscriptionType: 'free',
          purchases: []
        });
        
        results.push({
          status: 'created',
          uid: userRecord.uid,
          email: userRecord.email,
          username: username
        });
        
        console.log('✅ Created missing document for:', userRecord.email);
      } else {
        results.push({
          status: 'already_exists',
          uid: userRecord.uid,
          email: userRecord.email
        });
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'User document check/creation complete',
      totalUsers: listUsersResult.users.length,
      created: results.filter(r => r.status === 'created').length,
      alreadyExisted: results.filter(r => r.status === 'already_exists').length,
      results: results
    });
    
  } catch (error) {
    console.error('❌ Error fixing users:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// FIX SPECIFIC USERS BY UID
// ============================================
exports.fixSpecificUsers = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    // The two broken accounts
    const brokenAccounts = [
      {
        uid: 'rd1OTlVUqWbabBsc9MK6ABtcXBC3',
        email: 'logan131whaley@gmail.com',
        username: 'logan131'
      },
      {
        uid: 'C3o6ceZdjIPK1yfVM252MVLSCGJ2',
        email: 'clpziscoollmao@gmail.com',
        username: 'clpziscoollmao'
      }
    ];

    const results = [];

    for (const account of brokenAccounts) {
      const userRef = admin.firestore().collection('users').doc(account.uid);
      const doc = await userRef.get();
      
      if (!doc.exists) {
        await userRef.set({
          uid: account.uid,
          username: account.username,
          email: account.email,
          hwid: 'N/A',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastLogin: admin.firestore.FieldValue.serverTimestamp(),
          accountStatus: 'active',
          subscriptionType: 'free',
          purchases: []
        });
        
        results.push({
          status: 'created',
          uid: account.uid,
          email: account.email
        });
        
        console.log('✅ Fixed account:', account.email);
      } else {
        results.push({
          status: 'already_exists',
          uid: account.uid,
          email: account.email
        });
        
        console.log('⚠️ Document already exists for:', account.email);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Specific users fixed',
      results: results
    });

  } catch (error) {
    console.error('❌ Error fixing specific users:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to update user subscription
async function updateUserSubscription(userId, items) {
  const tierPriority = { 'free': 0, 'media': 1, 'lite': 2, 'lifetime': 3 };
  let highestTier = 'free';

  items.forEach(item => {
    const tier = SUBSCRIPTION_MAP[item.name] || 'free';
    if (tierPriority[tier] > tierPriority[highestTier]) {
      highestTier = tier;
    }
  });

  const userRef = admin.firestore().collection('users').doc(userId);
  await userRef.set({
    subscriptionType: highestTier,
    lastPurchase: admin.firestore.FieldValue.serverTimestamp(),
    purchases: admin.firestore.FieldValue.arrayUnion(...items.map(i => i.name))
  }, { merge: true });

  console.log(`✅ User ${userId} subscription updated to: ${highestTier}`);
  return highestTier;
}

// ============================================
// STRIPE PAYMENT INTENT
// ============================================
exports.createStripePaymentIntent = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { amount, currency, customerEmail, userId, items } = req.body;

    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    let customer;
    const existingCustomers = await stripe.customers.list({
      email: customerEmail,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
        email: customerEmail,
        metadata: { userId: userId || 'guest' }
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: currency || 'usd',
      customer: customer.id,
      metadata: {
        userId: userId || 'guest',
        items: JSON.stringify(items || [])
      },
      receipt_email: customerEmail
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('Stripe Payment Intent Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CRYPTO PAYMENT (Coinbase Commerce)
// ============================================
exports.createCryptoPayment = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { amount, currency, userId, email, items } = req.body;

    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    const response = await axios.post(
      'https://api.commerce.coinbase.com/charges',
      {
        name: 'Kirk Client Purchase',
        description: `Purchase for ${email || 'customer'}`,
        pricing_type: 'fixed_price',
        local_price: {
          amount: amount.toFixed(2),
          currency: currency || 'USD'
        },
        metadata: {
          userId: userId || 'guest',
          email: email || '',
          items: JSON.stringify(items || [])
        },
        redirect_url: 'https://kirkclient.site/success.html',
        cancel_url: 'https://kirkclient.site/cancel.html'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-CC-Api-Key': 'bb55fe5c-9257-4393-a328-1ed43d378615',
          'X-CC-Version': '2018-03-22'
        }
      }
    );

    // Store pending crypto payment
    await admin.firestore().collection('crypto_payments').add({
      chargeId: response.data.data.id,
      userId: userId || 'guest',
      email: email || '',
      items: items || [],
      amount,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      chargeId: response.data.data.id,
      hostedUrl: response.data.data.hosted_url,
      code: response.data.data.code
    });

  } catch (error) {
    console.error('Coinbase Commerce Error:', error);
    res.status(500).json({ error: error.response?.data?.error?.message || error.message });
  }
});

// ============================================
// STRIPE WEBHOOK
// ============================================
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = functions.config().stripe.webhook_secret;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        const items = JSON.parse(paymentIntent.metadata.items || '[]');
        const userId = paymentIntent.metadata.userId;

        if (userId && userId !== 'guest') {
          await updateUserSubscription(userId, items);
        }

        await admin.firestore().collection('orders').add({
          paymentIntentId: paymentIntent.id,
          userId: userId || 'guest',
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency,
          items: items,
          status: 'completed',
          paymentMethod: 'stripe_card',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('✅ Payment succeeded:', paymentIntent.id);
        break;
      
      case 'payment_intent.payment_failed':
        console.error('❌ Payment failed:', event.data.object.id);
        break;
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).send('Webhook processing failed');
  }

  res.json({ received: true });
});

// ============================================
// COINBASE COMMERCE WEBHOOK
// ============================================
exports.coinbaseWebhook = functions.https.onRequest(async (req, res) => {
  try {
    const event = req.body;
    
    if (event.type === 'charge:confirmed') {
      const charge = event.data;
      const metadata = charge.metadata;
      const items = JSON.parse(metadata.items || '[]');
      const userId = metadata.userId;

      if (userId && userId !== 'guest') {
        await updateUserSubscription(userId, items);
      }

      // Update crypto payment status
      const snapshot = await admin.firestore()
        .collection('crypto_payments')
        .where('chargeId', '==', charge.id)
        .get();

      const updatePromises = [];
      snapshot.forEach(doc => {
        updatePromises.push(
          doc.ref.update({ 
            status: 'completed',
            completedAt: admin.firestore.FieldValue.serverTimestamp()
          })
        );
      });
      
      await Promise.all(updatePromises);

      // Get cryptocurrency type safely
      let cryptocurrency = 'unknown';
      if (charge.payments && charge.payments[0] && charge.payments[0].value && 
          charge.payments[0].value.crypto && charge.payments[0].value.crypto.currency) {
        cryptocurrency = charge.payments[0].value.crypto.currency;
      }

      await admin.firestore().collection('orders').add({
        chargeId: charge.id,
        chargeCode: charge.code,
        userId: userId || 'guest',
        amount: parseFloat(charge.pricing.local.amount),
        currency: charge.pricing.local.currency,
        items: items,
        status: 'completed',
        paymentMethod: 'crypto_coinbase',
        cryptocurrency: cryptocurrency,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log('✅ Crypto payment confirmed:', charge.id);
    } else if (event.type === 'charge:failed') {
      console.error('❌ Crypto payment failed:', event.data.id);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Coinbase webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});
