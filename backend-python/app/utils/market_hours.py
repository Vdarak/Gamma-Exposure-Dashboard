from datetime import datetime
from zoneinfo import ZoneInfo

def is_us_market_open() -> bool:
    """
    Check if the US market is currently open.
    Trading hours: 9:30 AM to 4:00 PM EST/EDT (America/New_York), Monday to Friday.
    """
    now = datetime.now(ZoneInfo("America/New_York"))
    # Check weekend
    if now.weekday() >= 5:
        return False
        
    start_min = 9 * 60 + 30  # 9:30 AM
    end_min = 16 * 60       # 4:00 PM
    current_min = now.hour * 60 + now.minute
    
    return start_min <= current_min < end_min

def is_india_market_open() -> bool:
    """
    Check if the Indian market is currently open.
    Trading hours: 9:15 AM to 3:30 PM IST (Asia/Kolkata), Monday to Friday.
    """
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    # Check weekend
    if now.weekday() >= 5:
        return False
        
    start_min = 9 * 60 + 15  # 9:15 AM
    end_min = 15 * 60 + 30  # 3:30 PM
    current_min = now.hour * 60 + now.minute
    
    return start_min <= current_min < end_min
