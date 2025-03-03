// app/api/process-sales/route.js
import { NextResponse } from 'next/server';
import axios from 'axios';

const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
const GA4_API_SECRET = process.env.GA4_API_SECRET;
const CTM_AUTH_STRING = process.env.CTM_AUTH_STRING;

/**
 * Checks the phone number in CallTrackingMetrics.
 * Returns an array of calls if found, or null if not found.
 */
async function checkPhoneNumberInCTM(phoneNumber) {
  const contactNumber = phoneNumber.replace(/\D/g, '');
  const url = 'https://api.calltrackingmetrics.com/api/v1/accounts/540774/calls/search.json';
  const data = {
    filter: `contact_number:"${contactNumber}"`,
    sort_by: 'call_started_at',
    sort_order: 'asc',
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        Authorization: `Basic ${CTM_AUTH_STRING}`,
      },
    });
    // response.data.calls should be an array if found
    if (response.data && response.data.calls) {
      return response.data.calls;
    }
    return null;
  } catch (error) {
    console.error('Error searching phone number in CTM:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Loops through an array of CTM calls.
 * Returns the first found source/medium/campaign in an object.
 */
function determineAttribution(calls) {
  if (!Array.isArray(calls) || calls.length === 0) {
    return { source: null, medium: null, campaign: null };
  }

  for (const call of calls) {
    if (call?.paid?.source) {
      return {
        source: call.paid.source,
        medium: call.paid.medium,
        campaign: call.paid.campaign || null,
      };
    }
  }

  // If no call had a "paid" object with source/medium
  return { source: null, medium: null, campaign: null };
}

/**
 * Sends purchase event to Google Analytics 4.
 */
async function sendToGA4(transactionId, revenue, source, medium, campaign) {
  const ga4Endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;

  const payload = {
    client_id: `12345678.${Date.now()}`, // Random-ish client ID
    events: [
      {
        name: 'phone_purchase',
        params: {
          transaction_id: transactionId,
          value: revenue,
          currency: 'USD',
          source: source || 'unknown',
          medium: medium || 'unknown',
          campaign: campaign || 'unknown',
        },
      },
    ],
  };

  try {
    const response = await axios.post(ga4Endpoint, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    return response;
  } catch (error) {
    console.error('Error sending data to GA4:', error.message);
    throw error;
  }
}

/**
 * Handle POST requests to /api/process-sales
 */
export async function POST(request) {
  try {
    const webhookData = await request.json();
    console.log('Received webhook data:', webhookData);


    if (!webhookData.phoneNumber) {
      console.log('No phone number found. Skipping.');
      return NextResponse.json({ message: 'No phone number found' }, { status: 404 });
    }

    let phoneNumber = webhookData.phoneNumber;
    let transactionId = webhookData.transactionId;
    let revenue = webhookData.totalAmountExcludingTax;


    // 1. Check phone number in CTM
    const ctmData = await checkPhoneNumberInCTM(phoneNumber);
    console.log('CTM Data:', ctmData);
    if (!ctmData || ctmData.length === 0) {
      console.log('No matching phone number in CTM. Skipping.');
      return new NextResponse(null, { status: 204 });
    }

    // 2. Determine attribution (source, medium, campaign)
    const { source, medium, campaign } = determineAttribution(ctmData);

    // 3. Push data to GA4
    const ga4Response = await sendToGA4(transactionId, revenue, source, medium, campaign);
    console.log('GA4 Response status:', ga4Response.status);

    return NextResponse.json({ message: 'Data successfully sent to GA4', ga4Status: ga4Response.status }, { status: 200 });
  } catch (error) {
    console.error('Error processing webhook:', error.message);
    return NextResponse.json(
      { message: 'Internal Server Error', error: error.message },
      { status: 500 }
    );
  }
}