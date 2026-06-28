import pandas as pd
import numpy as np
import logging

logger = logging.getLogger("gamma-exposure-backend.backtester.strategy_builder")

def get_value_series(df: pd.DataFrame, indicator: str | int | float) -> pd.Series | float:
    """Helper to retrieve a Series for a column name or a constant numeric value."""
    if isinstance(indicator, (int, float)):
        return float(indicator)
        
    try:
        return float(indicator)
    except (ValueError, TypeError):
        pass
        
    col = str(indicator).lower().strip()
    if col == "price":
        col = "close"
        
    if col in df.columns:
        return df[col]
    else:
        logger.warning(f"Indicator column '{col}' not found in DataFrame. Returning NaN Series.")
        return pd.Series(np.nan, index=df.index)

def evaluate_condition(df: pd.DataFrame, cond: dict) -> pd.Series:
    """
    Evaluates a single condition dictionary against the DataFrame and returns a Boolean Series.
    """
    ind1_name = cond.get("indicator1")
    op = str(cond.get("operator", "")).lower().strip()
    ind2_val = cond.get("indicator2")
    
    val1 = get_value_series(df, ind1_name)
    val2 = get_value_series(df, ind2_val)
    
    # Generate Boolean series
    if op in ["greater_than", ">", ">="]:
        return val1 > val2
    elif op in ["less_than", "<", "<="]:
        return val1 < val2
    elif op in ["equals", "=", "=="]:
        if isinstance(val2, (int, float)):
            return (val1 - val2).abs() < 1e-4
        return (val1 - val2).abs() < 1e-4
    elif op in ["crosses_above", "crossesabove"]:
        prev_val1 = val1.shift(1)
        prev_val2 = val2.shift(1) if isinstance(val2, pd.Series) else val2
        return (val1 > val2) & (prev_val1 <= prev_val2)
    elif op in ["crosses_below", "crossesbelow"]:
        prev_val1 = val1.shift(1)
        prev_val2 = val2.shift(1) if isinstance(val2, pd.Series) else val2
        return (val1 < val2) & (prev_val1 >= prev_val2)
    else:
        logger.warning(f"Unknown operator '{op}' in condition. Returning False Series.")
        return pd.Series(False, index=df.index)

def compile_rules(df: pd.DataFrame, rules: list[dict]) -> pd.Series:
    """
    Combines all rules (conditions) using logical AND.
    Returns a Boolean Series.
    """
    if not rules:
        return pd.Series(False, index=df.index)
        
    # Start with all True
    combined = pd.Series(True, index=df.index)
    
    for rule in rules:
        cond_series = evaluate_condition(df, rule)
        # Handle NaN values as False
        cond_series = cond_series.fillna(False)
        combined = combined & cond_series
        
    return combined
