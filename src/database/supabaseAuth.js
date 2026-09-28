// src/database/supabaseAuth.js
const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');

class SupabaseAuthService {
    constructor() {
        this.client = null;
        this.session = null;
        this.refreshTimer = null;
        this.isAuthenticated = false;
        this.authPromise = null;
        this.initializeClient();
    }

    initializeClient() {
        if (!config.supabase.url || !config.supabase.key) {
            console.warn('⚠️ Supabase URL or key not configured in supabaseAuth');
            return;
        }

        // Initialize Supabase client with anon key (for authentication)
        this.client = createClient(config.supabase.url, config.supabase.key, {
            auth: {
                autoRefreshToken: true,
                persistSession: false, // We'll handle session persistence manually
                detectSessionInUrl: false
            }
        });

        // Set up auth state change listener
        this.client.auth.onAuthStateChange((event, session) => {
            console.log('🔐 Auth state changed:', event);
            if (session) {
                this.session = session;
                this.isAuthenticated = true;
            } else if (event === 'SIGNED_OUT') {
                this.session = null;
                this.isAuthenticated = false;
            }

            if (event === 'SIGNED_IN' && session) {
                console.log('✅ Bot user authenticated successfully');
                this.scheduleTokenRefresh(session);
            } else if (event === 'TOKEN_REFRESHED' && session) {
                console.log('🔄 Token refreshed successfully');
                this.scheduleTokenRefresh(session);
            }
        });
    }

    async authenticate() {
        if (this.authPromise) {
            return await this.authPromise;
        }

        this.authPromise = (async () => {
            try {
                if (!this.client) {
                    this.isAuthenticated = false;
                    return false;
                }

                console.log('🔐 Authenticating bot user...');
                
                const { data, error } = await this.client.auth.signInWithPassword({
                    email: process.env.email,
                    password: process.env.mailpass
                });

                if (error) {
                    console.error('❌ Authentication failed:', error.message);
                    this.isAuthenticated = false;
                    return false;
                }

                if (data && data.session) {
                    this.session = data.session;
                    this.isAuthenticated = true;
                    this.scheduleTokenRefresh(data.session);
                }

                console.log('✅ Bot user authenticated:', data.user?.email || 'success');
                return true;
            } catch (error) {
                console.error('❌ Authentication error:', error);
                this.isAuthenticated = false;
                return false;
            } finally {
                this.authPromise = null;
            }
        })();

        return await this.authPromise;
    }

    scheduleTokenRefresh(session) {
        // Clear existing timer
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }

        if (!session || !session.expires_at) {
            return;
        }

        // Calculate time until token expires (refresh 5 minutes before expiry)
        const expiresAt = session.expires_at * 1000; // Convert to milliseconds
        const now = Date.now();
        const refreshTime = expiresAt - now - (5 * 60 * 1000); // 5 minutes before expiry

        if (refreshTime > 0) {
            console.log(`⏰ Token refresh scheduled in ${Math.round(refreshTime / 1000 / 60)} minutes`);
            this.refreshTimer = setTimeout(() => {
                this.refreshSession();
            }, refreshTime);
            if (this.refreshTimer && typeof this.refreshTimer.unref === 'function') {
                this.refreshTimer.unref();
            }
        }
    }

    async refreshSession() {
        try {
            console.log('🔄 Refreshing session...');
            const { data, error } = await this.client.auth.refreshSession();
            
            if (error || !data?.session) {
                console.warn('⚠️ Token refresh failed, re-authenticating bot user:', error?.message);
                return await this.authenticate();
            }

            this.session = data.session;
            this.isAuthenticated = true;
            this.scheduleTokenRefresh(data.session);
            console.log('🔄 Token refreshed successfully');
            return true;
        } catch (error) {
            console.error('❌ Session refresh error:', error.message);
            return await this.authenticate();
        }
    }

    async ensureAuthenticated() {
        if (this.authPromise) {
            await this.authPromise;
        }

        const now = Date.now();
        const expiresAt = this.session?.expires_at ? this.session.expires_at * 1000 : 0;
        const timeUntilExpiry = expiresAt - now;

        // Re-authenticate if unauthenticated, missing session, expired, or expiring within 2 minutes
        if (!this.isAuthenticated || !this.session || timeUntilExpiry <= (2 * 60 * 1000)) {
            console.log(`🔄 Session invalid or expiring in ${Math.round(timeUntilExpiry / 1000)}s, authenticating...`);
            return await this.authenticate();
        }

        return true;
    }

    getAuthenticatedClient() {
        if (!this.isAuthenticated) {
            throw new Error('Bot user not authenticated. Call ensureAuthenticated() first.');
        }
        return this.client;
    }

    async signOut() {
        try {
            if (this.refreshTimer) {
                clearTimeout(this.refreshTimer);
                this.refreshTimer = null;
            }
            
            await this.client.auth.signOut();
            this.isAuthenticated = false;
            this.session = null;
            console.log('👋 Bot user signed out');
        } catch (error) {
            console.error('Error signing out:', error);
        }
    }

    // Health check method
    getAuthStatus() {
        return {
            isAuthenticated: this.isAuthenticated,
            userId: this.session?.user?.id || null,
            email: this.session?.user?.email || null,
            expiresAt: this.session?.expires_at ? new Date(this.session.expires_at * 1000).toISOString() : null,
            hasRefreshTimer: !!this.refreshTimer
        };
    }
}

// Export singleton instance
module.exports = new SupabaseAuthService();