import os
import json
import re
from datetime import datetime
from typing import Dict, List, Optional

import discord
from discord.ext import commands
from discord import app_commands

# ================== CONFIG ==================

GUILD_ID = 1199076619411804220
ORDERS_CHANNEL_ID = 1438824471522705490
ALLOWED_RESET_USER_IDS = {672771437672529933}

STATE_FILE = "orders_state.json"
ORDER_PREFIX = "📦 **New 3D Print Order #"


def load_token_from_file(path: str = "DISCORD_TOKEN.txt") -> str:
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    # If someone accidentally leaves quotes, strip them
    if raw.startswith('"') and raw.endswith('"'):
        raw = raw[1:-1].strip()
    return raw

DISCORD_TOKEN = load_token_from_file()

STATE_FILE = "orders_state.json"
ORDER_PREFIX = "📦 **New 3D Print Order #"


# ================== STATE HANDLING ==================

def load_state() -> Dict:
    if not os.path.exists(STATE_FILE):
        return {"orders": []}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"orders": []}


def save_state(state: Dict):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def today_key() -> str:
    now = datetime.now()
    return f"{now.year:04d}{now.month:02d}{now.day:02d}"


def add_order_to_state(order_id: str, est_total: Optional[float]):
    state = load_state()
    orders = state.get("orders", [])

    # avoid duplicates
    if any(o.get("order_id") == order_id for o in orders):
        return

    date_part = order_id.split("-")[0] if "-" in order_id else today_key()
    entry = {
        "order_id": order_id,
        "date": date_part
    }
    if est_total is not None:
        entry["est_total"] = float(est_total)

    orders.append(entry)
    state["orders"] = orders
    save_state(state)


def get_orders_for_date(date_key: str) -> List[Dict]:
    state = load_state()
    return [o for o in state.get("orders", []) if o.get("date") == date_key]


def get_all_orders() -> List[Dict]:
    state = load_state()
    return state.get("orders", [])


def reset_today_orders():
    state = load_state()
    dk = today_key()
    state["orders"] = [o for o in state.get("orders", []) if o.get("date") != dk]
    save_state(state)


def sum_estimated_revenue(orders: List[Dict]) -> float:
    total = 0.0
    for o in orders:
        val = o.get("est_total")
        if isinstance(val, (int, float)):
            total += float(val)
    return total


# ================== PARSING REVENUE FROM MESSAGE ==================

def parse_estimated_total_from_message(content: str) -> Optional[float]:
    """
    Looks for lines like: 'Estimated total: $12.50'
    Sums all such totals in the message.
    """
    total = 0.0
    found_any = False

    for line in content.splitlines():
        if "Estimated total" in line:
            m = re.search(r"\$([0-9]+(?:\.[0-9]+)?)", line)
            if m:
                try:
                    val = float(m.group(1))
                    total += val
                    found_any = True
                except ValueError:
                    continue

    if not found_any:
        return None
    return total


# ================== DISCORD BOT SETUP ==================

intents = discord.Intents.default()
intents.message_content = True  # must also be enabled in Developer Portal

bot = commands.Bot(command_prefix="!", intents=intents)


@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} (ID: {bot.user.id})")
    try:
        guild = discord.Object(id=GUILD_ID)
        bot.tree.copy_global_to(guild=guild)
        await bot.tree.sync(guild=guild)
        print("Slash commands synced.")
    except Exception as e:
        print("Error syncing commands:", e)


# ================== MESSAGE LISTENER ==================

@bot.event
async def on_message(message: discord.Message):
    # allow commands to work
    await bot.process_commands(message)

    # Only care about orders channel
    if message.channel.id != ORDERS_CHANNEL_ID:
        return

    # Orders are from the webhook (bot user)
    if not message.author.bot:
        return

    content = message.content or ""
    if not content.startswith(ORDER_PREFIX):
        return

    first_line = content.splitlines()[0]
    try:
        after_hash = first_line.split("#", 1)[1]
        order_id = after_hash.split("**", 1)[0].strip()
    except Exception:
        return

    if not order_id:
        return

    est_total = parse_estimated_total_from_message(content)
    add_order_to_state(order_id, est_total)
    print(f"Recorded order: {order_id} | est_total={est_total}")


# ================== SLASH COMMANDS ==================

class OrdersCommands(app_commands.Group):
    def __init__(self):
        super().__init__(name="orders", description="3D print order tracking commands")

    @app_commands.command(name="today", description="Show today's orders and estimated revenue")
    async def today(self, interaction: discord.Interaction):
        dk = today_key()
        todays = get_orders_for_date(dk)
        count = len(todays)
        revenue = sum_estimated_revenue(todays)

        if count == 0:
            await interaction.response.send_message(
                f"No orders recorded for today ({dk}).",
                ephemeral=True
            )
            return

        ids = ", ".join(o["order_id"] for o in todays)
        msg = (
            f"📊 Orders for today ({dk}): **{count}**\n"
            f"Order IDs: {ids}\n"
        )
        if revenue > 0:
            msg += f"Estimated revenue today: **${revenue:.2f}**"
        else:
            msg += "Estimated revenue today: *(no estimates parsed)*"

        await interaction.response.send_message(msg, ephemeral=True)

    @app_commands.command(name="stats", description="Show total orders and per-day revenue summary")
    async def stats(self, interaction: discord.Interaction):
        orders = get_all_orders()
        if not orders:
            await interaction.response.send_message(
                "No orders recorded yet.",
                ephemeral=True
            )
            return

        per_day_counts: Dict[str, int] = {}
        per_day_revenue: Dict[str, float] = {}

        for o in orders:
            date_key = o.get("date")
            if not date_key:
                # fallback: use today_key if missing
                date_key = today_key()
            per_day_counts[date_key] = per_day_counts.get(date_key, 0) + 1

            est = o.get("est_total")
            if isinstance(est, (int, float)):
                per_day_revenue[date_key] = per_day_revenue.get(date_key, 0.0) + float(est)

        total_orders = len(orders)
        total_revenue = sum_estimated_revenue(orders)

        sorted_days = sorted(per_day_counts.keys(), reverse=True)

        lines = []
        for date_key in sorted_days[:10]:  # last 10 days max
            c = per_day_counts[date_key]
            rev = per_day_revenue.get(date_key, 0.0)
            if rev > 0:
                lines.append(f"- {date_key}: **{c}** orders | est. **${rev:.2f}**")
            else:
                lines.append(f"- {date_key}: **{c}** orders | est. *(no estimates)*")

        msg = "📈 **Order stats**\n"
        msg += f"Total recorded orders: **{total_orders}**\n"
        if total_revenue > 0:
            msg += f"Total estimated revenue: **${total_revenue:.2f}**\n\n"
        else:
            msg += "Total estimated revenue: *(no estimates parsed yet)*\n\n"

        msg += "Recent days:\n" + "\n".join(lines)

        await interaction.response.send_message(msg, ephemeral=True)

    @app_commands.command(
        name="reset_today",
        description="Reset today's order counter and revenue (bot tracking only, admin use)."
    )
    async def reset_today(self, interaction: discord.Interaction):
        user_id = interaction.user.id
        if user_id not in ALLOWED_RESET_USER_IDS:
            await interaction.response.send_message(
                "You are not allowed to reset today's orders.",
                ephemeral=True
            )
            return

        reset_today_orders()
        dk = today_key()
        await interaction.response.send_message(
            f"✅ Cleared all recorded orders for today ({dk}) from bot tracking.\n"
            f"(Messages in the channel are not deleted.)",
            ephemeral=True
        )


bot.tree.add_command(OrdersCommands())


# ================== MAIN ==================

if __name__ == "__main__":
    if not DISCORD_TOKEN:
        raise RuntimeError("No token loaded from DISCORD_TOKEN.txt")
    bot.run(DISCORD_TOKEN)