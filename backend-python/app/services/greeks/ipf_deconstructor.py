"""
Re-export IPF deconstructor from core.ipf_deconstructor
"""
from core.ipf_deconstructor import (
    PARTICIPANTS,
    PARTICIPANT_INDEX,
    generate_prior_weights,
    fit_ipf,
    IPFDeconstructor,
)

__all__ = [
    "PARTICIPANTS",
    "PARTICIPANT_INDEX",
    "generate_prior_weights",
    "fit_ipf",
    "IPFDeconstructor",
]
