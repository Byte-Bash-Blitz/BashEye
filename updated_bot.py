import os
import discord
import requests
from flask import Flask
from threading import Thread
from dotenv import load_dotenv
from datetime import datetime
import re

# Load .env variables
load_dotenv()

# ENV config
TOKEN = os.getenv('DISCORD_BOT_TOKEN')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_ANON_KEY')
GUILD_ID = int(os.getenv('DISCORD_GUILD_ID'))
BASHER_PROGRESS_CATEGORY_ID = 1351223065354178722  # Your category ID
ORGANISER_ID = 77  # Bot's unique ID in your database
DAILY_POINTS = 5
MIN_WORD_COUNT = 50

# Store daily submissions to prevent duplicate points
daily_submissions = {}  # Format: user_id-date => True

# Flask App for Replit Uptime Pings
app = Flask('')

@app.route('/')
def home():
    return "Bot is alive!", 200

def run():
    app.run(host='0.0.0.0', port=8080)

def keep_alive():
    t = Thread(target=run)
    t.start()

# Discord bot setup
intents = discord.Intents.default()
intents.messages = True
intents.guilds = True
intents.message_content = True

client = discord.Client(intents=intents)

def get_today_date_string():
    """Get today's date in format for description (e.g., 20Sep25)"""
    today = datetime.now()
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    day = today.day
    month = months[today.month - 1]
    year = str(today.year)[-2:]
    return f"{day}{month}{year}"

def get_today_key():
    """Get today's date key for tracking"""
    return datetime.now().strftime("%Y-%m-%d")

def count_words(text):
    """Count words in text"""
    if not text:
        return 0
    words = text.strip().split()
    return len([word for word in words if word])

def has_image_attachment(message):
    """Check if message has image attachment"""
    if not message.attachments:
        return False
    
    for attachment in message.attachments:
        if attachment.content_type and attachment.content_type.startswith('image/'):
            return True
    return False

def has_received_points_today(user_id):
    """Check if user already received points today"""
    today_key = get_today_key()
    submission_key = f"{user_id}-{today_key}"
    return submission_key in daily_submissions

def mark_points_awarded(user_id):
    """Mark user as having received points today"""
    today_key = get_today_key()
    submission_key = f"{user_id}-{today_key}"
    daily_submissions[submission_key] = True

def get_member_id_by_discord_username(discord_username):
    """Fetch member.id from Supabase 'members' table by discord_username."""
    url = f"{SUPABASE_URL}/rest/v1/members?discord_username=eq.{discord_username}&select=id"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        if data:
            return data[0]['id']
        return None
    except Exception as e:
        print(f"[❌] Error fetching member_id for {discord_username}: {e}")
        return None

def award_points(member_id, date_string):
    """Award points to member in points table"""
    try:
        description = f"PU-{date_string}"
        
        url = f"{SUPABASE_URL}/rest/v1/points"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        
        payload = {
            "member_id": member_id,
            "organiser_id": ORGANISER_ID,
            "points": DAILY_POINTS,
            "description": description
        }
        
        response = requests.post(url, json=payload, headers=headers)
        if response.status_code in [200, 201, 204]:
            print(f"[✅] Awarded {DAILY_POINTS} points to member {member_id} for {description}")
            return True
        else:
            print(f"[❌] Error inserting points: {response.status_code} {response.text}")
            return False
            
    except Exception as e:
        print(f"[❌] Error in award_points: {e}")
        return False

def is_in_basher_progress_category(channel):
    """Check if channel is in basher-progress category"""
    try:
        print(f"[🔍] Checking channel: {channel.name} (ID: {channel.id}, Type: {channel.type})")
        print(f"[📁] Channel category_id: {channel.category_id}")
        print(f"[🎯] Looking for category ID: {BASHER_PROGRESS_CATEGORY_ID}")
        
        # Direct category check
        if channel.category_id == BASHER_PROGRESS_CATEGORY_ID:
            print(f"[✅] DIRECT MATCH: Channel is directly in basher-progress category!")
            return True
        
        # For forum threads, check if the parent channel's category matches
        if hasattr(channel, 'parent') and channel.parent:
            print(f"[📋] Thread detected. Parent: {channel.parent.name} (ID: {channel.parent.id})")
            print(f"[📁] Parent's category_id: {channel.parent.category_id}")
            
            if channel.parent.category_id == BASHER_PROGRESS_CATEGORY_ID:
                print(f"[✅] THREAD MATCH: Parent channel is in basher-progress category!")
                return True

        print(f"[❌] No match found - category_id: {channel.category_id}")
        return False
        
    except Exception as e:
        print(f"[❌] Error checking channel category: {e}")
        return False

@client.event
async def on_ready():
    print(f"[🚀] {client.user} is online and monitoring basher-progress!")
    print(f"[📊] Monitoring guild: {GUILD_ID}")
    print(f"[📁] Looking for category ID: {BASHER_PROGRESS_CATEGORY_ID}")
    print(f"[💰] Daily points: {DAILY_POINTS}")
    print(f"[📝] Minimum words: {MIN_WORD_COUNT}")
    
    # List all categories in the guild for debugging
    guild = client.get_guild(GUILD_ID)
    if guild:
        print("\n[📂] Available categories in server:")
        for channel in guild.channels:
            if isinstance(channel, discord.CategoryChannel):
                print(f"   - {channel.name} (ID: {channel.id})")
        print("")

@client.event
async def on_message(message):
    # Log ALL messages first to debug
    print(f"\n[🔗] RAW MESSAGE RECEIVED:")
    print(f"   Author: {message.author} (Bot: {message.author.bot})")
    print(f"   Channel: {message.channel.name} (ID: {message.channel.id})")
    print(f"   Channel Type: {message.channel.type}")
    print(f"   Guild: {message.guild.name if message.guild else 'DM'}")
    
    # Ignore bot messages
    if message.author.bot:
        print(f"[🤖] Ignoring bot message")
        return
    
    # Check if message is from the correct guild
    if not message.guild or message.guild.id != GUILD_ID:
        print(f"[❌] Message not from monitored guild, ignoring")
        return

    print(f"\n[📩] Processing message from {message.author} in #{message.channel.name}")

    # Check if message is in the right category
    if not is_in_basher_progress_category(message.channel):
        print(f"[❌] Message not in basher-progress category, ignoring")
        return

    print(f"[✅] Message is in basher-progress category!")

    # Check if message has an image attachment
    if not has_image_attachment(message):
        print(f"[❌] Message from {message.author} has no image attachment")
        return

    # Check if message has at least 50 words
    word_count = count_words(message.content)
    if word_count < MIN_WORD_COUNT:
        print(f"[❌] Message from {message.author} has only {word_count} words (minimum: {MIN_WORD_COUNT})")
        return

    # Check if user already received points today
    if has_received_points_today(message.author.id):
        print(f"[ℹ️] {message.author} already received points today")
        return

    # Get member ID from database
    discord_username = str(message.author)
    member_id = get_member_id_by_discord_username(discord_username)
    if not member_id:
        print(f"[❌] Member {discord_username} not found in database")
        return

    # Award points
    date_string = get_today_date_string()
    success = award_points(member_id, date_string)
    
    if success:
        mark_points_awarded(message.author.id)
        
        # React to the message to show it was processed
        try:
            await message.add_reaction('✅')
            print(f"[🎉] Successfully processed daily update from {message.author}")
        except Exception as e:
            print(f"[❌] Error reacting to message: {e}")

@client.event
async def on_thread_create(thread):
    print(f"[🧵] New thread created: {thread.name} in {thread.parent.name if thread.parent else 'unknown'}")
    if thread.parent and hasattr(thread.parent, 'category'):
        print(f"   Parent category: {thread.parent.category.name} (ID: {thread.parent.category.id})")

# Keep alive server for Replit
keep_alive()

# Start the bot
client.run(TOKEN)