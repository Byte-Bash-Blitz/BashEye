# Supabase RLS Authentication Setup

This document explains how the Discord bot authenticates with Supabase using a dedicated bot user account to comply with Row Level Security (RLS) policies.

## 🔐 Authentication Architecture

### Previous Setup (Service Role)
- Used `SUPABASE_ANON_KEY` (service role key)
- Bypassed RLS policies entirely
- Security concern: Full database access

### New Setup (Bot User Authentication)
- Uses dedicated bot user: `basheye@bytebashblitz.org`
- Authenticates with email/password
- Respects RLS policies
- Automatic token refresh and session management

## 📁 File Structure

```
src/database/
├── supabaseAuth.js     # Authentication service with session management
└── supabase.js         # Database operations using authenticated client
```

## 🛠️ Implementation Details

### 1. Authentication Service (`supabaseAuth.js`)

**Key Features:**
- Automatic login with bot user credentials
- Token refresh scheduling (5 minutes before expiry)  
- Session persistence and recovery
- Auth state monitoring
- Graceful error handling and re-authentication

**Environment Variables:**
```env
email=basheye@bytebashblitz.org
mailpass=Remain-Brief-Peace7-Ancient-Wing
```

### 2. Database Service (`supabase.js`)

**Updated Methods:**
- All database operations now use `await this.getClient()`
- Ensures authentication before each database call
- Fallback to anon client if authentication fails
- Graceful handling of auth errors

### 3. Session Management

**Automatic Refresh:**
- Monitors token expiration (stored in `session.expires_at`)
- Schedules refresh 5 minutes before expiry
- Re-authenticates if refresh fails
- Logs all auth state changes

**Health Monitoring:**
- `/auth/status` endpoint for monitoring authentication
- Real-time auth status with expiration times
- Integration with existing bot status API

## 🚀 Usage

### Starting the Bot
```bash
npm run dev
```

**Expected Authentication Flow:**
```
🔐 Initializing bot user authentication...
🔐 Authenticating bot user...
🔐 Auth state changed: SIGNED_IN
✅ Bot user authenticated successfully
⏰ Token refresh scheduled in 55 minutes
✅ Bot user authenticated: basheye@bytebashblitz.org
```

### Monitoring Authentication

**Check Auth Status:**
```bash
curl http://localhost:3001/auth/status
```

**Expected Response:**
```json
{
  "isAuthenticated": true,
  "userId": "a11c3ced-a8a8-4676-a15e-6374c8250ab6",
  "email": "basheye@bytebashblitz.org", 
  "expiresAt": "2025-10-08T08:06:42.000Z",
  "hasRefreshTimer": true,
  "timestamp": "2025-10-08T07:07:20.248Z"
}
```

## 🔧 RLS Policy Requirements

### Points Table Policies
The bot user must have policies allowing:
- `INSERT` on points table (for awarding points)
- `SELECT` on points table (for streak calculation)
- `UPDATE` on points table (if needed)

### Member Stats Table Policies  
- `SELECT` and `UPDATE` on member_stats table
- `INSERT` for creating new member records

### Members Table Policies
- `SELECT` access for Discord username lookup

## 🛡️ Security Benefits

1. **RLS Compliance**: Bot respects database security policies
2. **Principle of Least Privilege**: Bot only has necessary permissions
3. **Audit Trail**: All operations are associated with bot user
4. **Token Security**: Automatic refresh prevents token expiration
5. **Graceful Degradation**: Fallback mechanisms for auth failures

## 🔍 Troubleshooting

### Authentication Failures
- Check bot user credentials in `.env` file
- Verify bot user exists in Supabase Auth
- Ensure bot user has necessary RLS permissions

### Token Refresh Issues
- Monitor logs for refresh attempts
- Check `/auth/status` endpoint for expiration times
- Restart bot if persistent auth issues occur

### Database Access Errors
- Verify RLS policies allow bot user operations
- Check error logs for specific permission issues
- Test individual endpoints to isolate problems

## 📊 Monitoring

The system provides comprehensive logging:
- Authentication events and state changes
- Token refresh scheduling and execution  
- Database operation success/failure with auth context
- API endpoint for real-time auth status

## 🚀 Benefits Over Service Role

1. **Security**: Follows authentication best practices
2. **Compliance**: Works with strict RLS policies
3. **Monitoring**: Better visibility into auth status
4. **Scalability**: Can be extended for multiple bot users
5. **Maintenance**: Automatic session management reduces manual intervention

This setup ensures your Discord bot operates securely within Supabase's RLS framework while maintaining full functionality for point awarding and streak tracking.