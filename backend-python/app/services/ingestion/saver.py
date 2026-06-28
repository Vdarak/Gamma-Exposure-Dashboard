from sqlalchemy.ext.asyncio import AsyncSession
from app.models.option_snapshot import OptionSnapshot, OptionData
from app.services.ingestion.normalizer import NormalizedSnapshot

class DataSaverService:
    """
    Saves NormalizedSnapshot models to the PostgreSQL database.
    """
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def save_snapshot(self, snap: NormalizedSnapshot) -> int:
        """
        Inserts OptionSnapshot and OptionData rows into the database.
        Returns the ID of the created snapshot.
        """
        # 1. Create OptionSnapshot ORM object
        db_snapshot = OptionSnapshot(
            ticker=snap.ticker,
            timestamp=snap.timestamp,
            spot_price=snap.spot_price,
            data_count=len(snap.options),
            market=snap.market
        )
        self.db.add(db_snapshot)
        await self.db.flush()  # Exposes the snapshot ID
        
        snapshot_id = db_snapshot.id

        # 2. Bulk insert OptionData ORM objects
        db_options = []
        for opt in snap.options:
            db_opt = OptionData(
                snapshot_id=snapshot_id,
                strike=opt.strike,
                option_type=opt.option_type,
                expiration=opt.expiration,
                last_price=opt.last_price,
                bid=opt.bid,
                ask=opt.ask,
                volume=opt.volume,
                open_interest=opt.open_interest,
                implied_volatility=opt.implied_volatility,
                delta=opt.delta,
                gamma=opt.gamma,
                theta=opt.theta,
                vega=opt.vega,
                rho=opt.rho,
                change_in_oi=opt.change_in_oi,
                total_buy_qty=opt.total_buy_qty,
                total_sell_qty=opt.total_sell_qty
            )
            db_options.append(db_opt)

        self.db.add_all(db_options)
        await self.db.commit()
        
        print(f"   [Saver] Saved snapshot {snapshot_id} for {snap.ticker} ({len(db_options)} options).")
        return snapshot_id
