import os
import discord
import requests
from flask import Flask
from threading import Thread
from dotenv import load_dotenv

# Load .env variables
load_dotenv()

# ENV config
TOKEN = os.getenv('DISCORD_BOT_TOKEN')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_ANON_KEY')
ALLOWED_GUILD_IDS = os.getenv('ALLOWED_GUILD_IDS', '').split(',')  # Comma-separated IDs
TRACKED_CATEGORY_IDS = list(map(int, os.getenv('TRACKED_CATEGORY_IDS', '').split(',')))  # Also from env

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

def get_member_id(discord_username):
    """Fetch member.id from Supabase 'members' table."""
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
    except Exception as e:
        print(f"[❌] Error fetching member_id for {discord_username}: {e}")
    return None

def increment_discord_points(member_id, increment=1):
    """Increment 'discord_points' in 'member_stats' for given member_id."""
    url = f"{SUPABASE_URL}/rest/v1/member_stats?member_id=eq.{member_id}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }

    try:
        # Get current points
        get_points = requests.get(url + "&select=discord_points", headers=headers)
        get_points.raise_for_status()
        current = get_points.json()
        if not current:
            print(f"[❌] No member_stats found for member_id {member_id}")
            return
        current_points = current[0]['discord_points'] or 0
        new_points = current_points + increment

        # Update
        payload = { "discord_points": new_points }
        response = requests.patch(url, json=payload, headers=headers)
        if response.status_code in [200, 204]:
            print(f"[✅] Updated {member_id}: {current_points} ➜ {new_points}")
        else:
            print(f"[❌] Patch error: {response.status_code} {response.text}")

    except Exception as e:
        print(f"[❌] Error updating points: {e}")

@client.event
async def on_ready():
    print(f"[🚀] Logged in as {client.user} (ID: {client.user.id})")

@client.event
async def on_message(message):
    if message.author.bot or str(message.guild.id) not in ALLOWED_GUILD_IDS:
        return

    if message.channel.category_id not in TRACKED_CATEGORY_IDS:
        return

    discord_username = str(message.author)
    member_id = get_member_id(discord_username)
    if member_id:
        increment_discord_points(member_id)

# Keep alive server for Replit
keep_alive()

# Start the bot
client.run(TOKEN)