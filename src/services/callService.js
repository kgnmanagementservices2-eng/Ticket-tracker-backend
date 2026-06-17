const twilio = require("twilio");

// We use Twilio's AccessToken builder
const AccessToken = twilio.jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant; // VideoGrant handles WebRTC Rooms (Audio + Video)

const generateCallToken = (userId, ticketId) => {
  // 1. Verify we have the keys loaded
  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_API_KEY ||
    !process.env.TWILIO_API_SECRET
  ) {
    throw new Error(
      "Twilio credentials are missing from the server environment.",
    );
  }

  // 2. Create the token
  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_API_KEY,
    process.env.TWILIO_API_SECRET,
    {
      identity: userId, // The user's UUID is their unique caller ID
      ttl: 3600, // Token expires in 1 hour for security
    },
  );

  // 3. Grant them access ONLY to the room named after the ticket ID
  const grant = new VideoGrant({
    room: `ticket_huddle_${ticketId}`,
  });

  token.addGrant(grant);

  // 4. Serialize the token to a JWT string to send to the React frontend
  return token.toJwt();
};

module.exports = { generateCallToken };
