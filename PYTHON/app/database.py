import pymysql
import os
import re
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from urllib.parse import quote_plus

load_dotenv()

# Database Configuration from .env
DB_HOST = os.getenv("DB_HOST", "187.127.131.38")
DB_PORT = int(os.getenv("DB_PORT", "3312"))
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "Ener9y_Demo#2026")
DB_NAME = os.getenv("DB_NAME", "masters")
DB_NAME_SOLAR = os.getenv("DB_NAME_SOLAR", "solar")
DB_NAME_WINDMILL = os.getenv("DB_NAME_WINDMILL", "windmill")

# Timeouts for remote connection (Laptop to VPS)
CONNECT_TIMEOUT = 60
READ_TIMEOUT = 60

# Escape password for connection URL
db_password_escaped = quote_plus(DB_PASSWORD)

# --- SQLAlchemy Engines Configuration ---
# pool_pre_ping: Verifies connection is alive before every query
# pool_recycle: Refreshes connection every 5 mins (staying under the VPS 10-min limit)
engine_params = {
    "connect_args": {
        "connect_timeout": CONNECT_TIMEOUT, 
        "read_timeout": READ_TIMEOUT
    },
    "pool_pre_ping": True,
    "pool_recycle": 300,  
    "pool_size": 5,
    "max_overflow": 10
}

engine_masters = create_engine(
    f"mysql+pymysql://{DB_USER}:{db_password_escaped}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
    **engine_params
)
engine_windmill = create_engine(
    f"mysql+pymysql://{DB_USER}:{db_password_escaped}@{DB_HOST}:{DB_PORT}/{DB_NAME_WINDMILL}",
    **engine_params
)
engine_solar = create_engine(
    f"mysql+pymysql://{DB_USER}:{db_password_escaped}@{DB_HOST}:{DB_PORT}/{DB_NAME_SOLAR}",
    **engine_params
)

SessionLocalMasters = sessionmaker(autocommit=False, autoflush=False, bind=engine_masters)
SessionLocalWindmill = sessionmaker(autocommit=False, autoflush=False, bind=engine_windmill)
SessionLocalSolar = sessionmaker(autocommit=False, autoflush=False, bind=engine_solar)

# Bases for models
BaseMasters = declarative_base()
BaseWindmill = declarative_base()
BaseSolar = declarative_base()

def get_db():
    db = SessionLocalWindmill()
    try:
        yield db
    finally:
        db.close()

def get_db_solar():
    db = SessionLocalSolar()
    try:
        yield db
    finally:
        db.close()

def get_connection(db_name=None):
    """Returns a native pymysql connection for raw queries."""
    if db_name is None:
        db_name = DB_NAME
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=db_name,
        autocommit=False,
        connect_timeout=CONNECT_TIMEOUT,
        read_timeout=READ_TIMEOUT
    )

def initialize_database():
    """Ensure database, tables, and stored procedures exist on startup."""
    
    # 0. Initial pure pymysql connection to ensure DBs exist
    try:
        init_conn = pymysql.connect(
            host=DB_HOST, 
            port=DB_PORT,
            user=DB_USER, 
            password=DB_PASSWORD, 
            autocommit=True,
            connect_timeout=CONNECT_TIMEOUT,
            read_timeout=READ_TIMEOUT
        )
        init_cursor = init_conn.cursor()
        init_cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
        init_cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME_WINDMILL}")
        init_cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME_SOLAR}")
        init_cursor.close()
        init_conn.close()
        print("Databases ensured/created.")
    except Exception as e:
        print(f"Failed to ensure databases on startup: {e}")

    # IMPORT all models here to register them with metadata
    from app.models import customer_masters, master_models, windmill_masters, windmill_models

    # 1. Create all Tables
    print("Creating SQLAlchemy tables...")
    BaseMasters.metadata.create_all(bind=engine_masters)
    BaseWindmill.metadata.create_all(bind=engine_windmill)
    print("All SQLAlchemy tables have been created.")

    # 2. Initialize Stored Procedures
    sp_dir = os.path.join(os.path.dirname(__file__), "stored_procedure")
    if os.path.exists(sp_dir):
        db_map = {
            "masters": DB_NAME,
            "windmill": DB_NAME_WINDMILL
        }

        for folder_name, db_to_init in db_map.items():
            folder_path = os.path.join(sp_dir, folder_name)
            if not os.path.exists(folder_path):
                continue
                
            try:
                conn = get_connection(db_name=db_to_init)
                cursor = conn.cursor()
                print(f"Initializing SPs for: {db_to_init}")
                
                for filename in os.listdir(folder_path):
                    if filename.endswith(".sql"):
                        file_path = os.path.join(folder_path, filename)
                        with open(file_path, "r", encoding="utf-8") as f:
                            content = f.read()
                            
                            delimiter = ';'
                            if 'DELIMITER //' in content: delimiter = '//'
                            elif 'DELIMITER $$' in content: delimiter = '$$'
                            
                            content = re.sub(r"DELIMITER\s+\S+", "", content)
                            statements = content.split(delimiter)
                            
                            for statement in statements:
                                clean_s = statement.strip()
                                if clean_s.endswith(';'): clean_s = clean_s[:-1].strip()
                                if clean_s:
                                    try:
                                        cursor.execute(clean_s)
                                    except Exception as e:
                                        print(f"Error in {filename}: {e}")
                conn.commit()
                cursor.close()
                conn.close()
            except Exception as dbe:
                print(f"Failed to connect to {db_to_init} for SP: {dbe}")
        print("Stored procedures initialization complete.")