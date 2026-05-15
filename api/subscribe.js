export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { firstName, email } = req.body;

  if (!email || !firstName) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        email: email,
        attributes: { FIRSTNAME: firstName },
        listIds: [5],
        updateEnabled: true
      })
    });

    if (response.ok || response.status === 204) {
      return res.status(200).json({ success: true });
    } else {
      const err = await response.json();
      return res.status(400).json({ error: err });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
}
