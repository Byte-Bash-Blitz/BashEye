// src/database/supabaseAuth.js
const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');

class SupabaseAuthService {
    constructor() {
        this.client = null;
        this.session = null;
        this.refreshTimer = null;
        this.isAuthenticated = false;
        this.initializeClient();
    }

    initializeClient() {
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
            this.session = session;
            this.isAuthenticated = !!session;

            if (event === 'SIGNED_IN' && session) {
                console.log('✅ Bot user authenticated successfully');
                this.scheduleTokenRefresh(session);
            } else if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
                if (event === 'TOKEN_REFRESHED' && session) {
                    console.log('🔄 Token refreshed successfully');
                    this.scheduleTokenRefresh(session);
                }
            }
        });
    }

    async authenticate() {
        try {
            console.log('🔐 Authenticating bot user...');
            
            const { data, error } = await this.client.auth.signInWithPassword({
                email: process.env.email,
                password: process.env.mailpass
            });

            if (error) {
                console.error('❌ Authentication failed:', error.message);
                throw new Error(`Authentication failed: ${error.message}`);
            }

            console.log('✅ Bot user authenticated:', data.user.email);
            return true;
        } catch (error) {
            console.error('❌ Authentication error:', error);
            this.isAuthenticated = false;
            return false;
        }
    }

    scheduleTokenRefresh(session) {
        // Clear existing timer
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
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
        }
    }

    async refreshSession() {
        try {
            console.log('🔄 Refreshing session...');
            const { data, error } = await this.client.auth.refreshSession();
            
            if (error) {
                console.error('❌ Token refresh failed:', error.message);
                // Attempt re-authentication
                await this.authenticate();
            }
        } catch (error) {
            console.error('❌ Session refresh error:', error);
            // Attempt re-authentication
            await this.authenticate();
        }
    }

    async ensureAuthenticated() {
        if (!this.isAuthenticated || !this.session) {
            console.log('🔄 Re-authenticating bot user...');
            return await this.authenticate();
        }
        
        // Check if token is about to expire (within 10 minutes)
        if (this.session && this.session.expires_at) {
            const expiresAt = this.session.expires_at * 1000;
            const now = Date.now();
            const timeUntilExpiry = expiresAt - now;
            
            if (timeUntilExpiry < (10 * 60 * 1000)) { // Less than 10 minutes
                console.log('⏰ Token expiring soon, refreshing...');
                await this.refreshSession();
            }
        }
        
        return this.isAuthenticated;
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