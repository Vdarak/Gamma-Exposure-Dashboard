import pandas as pd
import pandas_ta as ta
import numpy as np
import logging

logger = logging.getLogger("gamma-exposure-backend.backtester.indicators")

def compute_indicators(df: pd.DataFrame, indicator_configs: list[dict]) -> pd.DataFrame:
    """
    Computes technical indicators using pandas-ta and adds them as columns to the DataFrame.
    """
    df = df.copy()
    
    for cfg in indicator_configs:
        itype = cfg.get("type", "").lower().strip()
        p1 = cfg.get("period1")
        p2 = cfg.get("period2", 26)
        sig = cfg.get("signalPeriod", 9)
        std_dev = cfg.get("stdDev", 2)
        
        try:
            if itype == "sma":
                col_name = f"sma_{p1}"
                df[col_name] = ta.sma(df["close"], length=p1)
                
            elif itype == "ema":
                col_name = f"ema_{p1}"
                df[col_name] = ta.ema(df["close"], length=p1)
                
            elif itype == "rsi":
                col_name = f"rsi_{p1}"
                df[col_name] = ta.rsi(df["close"], length=p1)
                
            elif itype == "macd":
                # Returns macd, macds, macdh
                macd_df = ta.macd(df["close"], fast=p1, slow=p2, signal=sig)
                if macd_df is not None:
                    # Rename columns to standardized formats
                    line_col = f"macd_line_{p1}_{p2}_{sig}"
                    signal_col = f"macd_signal_{p1}_{p2}_{sig}"
                    hist_col = f"macd_hist_{p1}_{p2}_{sig}"
                    
                    df[line_col] = macd_df.iloc[:, 0]
                    df[signal_col] = macd_df.iloc[:, 1]
                    df[hist_col] = macd_df.iloc[:, 2]
                    
            elif itype == "bb":
                # Returns lower, middle, upper band
                bb_df = ta.bbands(df["close"], length=p1, std=std_dev)
                if bb_df is not None:
                    upper_col = f"bb_upper_{p1}_{std_dev}"
                    middle_col = f"bb_middle_{p1}_{std_dev}"
                    lower_col = f"bb_lower_{p1}_{std_dev}"
                    
                    df[upper_col] = bb_df.iloc[:, 2]
                    df[middle_col] = bb_df.iloc[:, 1]
                    df[lower_col] = bb_df.iloc[:, 0]
                    
            elif itype == "atr":
                col_name = f"atr_{p1}"
                df[col_name] = ta.atr(df["high"], df["low"], df["close"], length=p1)
                
        except Exception as e:
            logger.error(f"Error computing indicator {itype} with periods ({p1}, {p2}): {e}")
            
    return df
