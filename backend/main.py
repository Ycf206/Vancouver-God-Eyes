from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import database
import models

# 確保在啟動時建立資料庫表結構 (包含 PostGIS 的空間欄位)
# 在正式環境中通常會使用 Alembic 來做版本控制，這裡為了快速啟動直接 create_all
try:
    models.Base.metadata.create_all(bind=database.engine)
except Exception as e:
    print(f"Database connection error on startup (might be booting): {e}")

app = FastAPI(title="Vancouver God's Eye API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Welcome to Vancouver God's Eye API", "status": "running"}

@app.get("/health")
async def health_check():
    return {"status": "ok", "database": "connected"}

@app.get("/api/alerts")
def get_alerts(db: Session = Depends(database.get_db)):
    """
    取得目前作用中的快訊 (提供給前端右下角顯示)
    """
    alerts = db.query(models.Alert).filter(models.Alert.active == True).all()
    return {"alerts": alerts}
