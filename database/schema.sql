-- Draftly Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    google_id VARCHAR(255) UNIQUE,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT NOT NULL,
    token_expiry TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    message_id VARCHAR(255) NOT NULL,
    thread_id VARCHAR(255),
    subject TEXT,
    from_email VARCHAR(255),
    to_emails TEXT[],
    cc_emails TEXT[],
    bcc_emails TEXT[],
    body_text TEXT,
    body_html TEXT,
    received_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, message_id)
);

-- Drafts table
CREATE TABLE IF NOT EXISTS drafts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    draft_id VARCHAR(255) NOT NULL,
    message_id VARCHAR(255),
    thread_id VARCHAR(255),
    subject TEXT,
    to_emails TEXT[],
    cc_emails TEXT[],
    bcc_emails TEXT[],
    body_text TEXT,
    body_html TEXT,
    status VARCHAR(50) DEFAULT 'PENDING_REVIEW',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, draft_id),
    UNIQUE(user_id, message_id)
);

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    endpoint VARCHAR(255),
    method VARCHAR(10),
    status_code INTEGER,
    ip_address VARCHAR(45),
    user_agent TEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_drafts_user_id ON drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_draft_id ON drafts(draft_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);

