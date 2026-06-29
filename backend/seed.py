from main import SessionLocal, engine, Base, User, Department, Issue, get_password_hash

def seed_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Clear existing
    db.query(User).delete()
    db.query(Department).delete()
    db.query(Issue).delete()
    db.commit()

    # Seed users
    db.add(User(id=1, name="Mayor Alice", email="admin@civisync.org", password_hash=get_password_hash("admin123"), role="admin", xp=150))
    db.add(User(id=2, name="John Citizen", email="john@citizen.org", password_hash=get_password_hash("citizen123"), role="citizen", xp=45))

    # Seed departments
    db.add(Department(id=1, name="Roads & Highways Department", contact_email="roads@civisync.org", contact_phone="+919840123456", head_name="Mr. Ram Kumar"))
    db.add(Department(id=2, name="Water Supply & Sewerage Board", contact_email="water@civisync.org", contact_phone="+919840123457", head_name="Mrs. Priya Raj"))
    db.add(Department(id=3, name="Electricity & Lighting Corporation", contact_email="electricity@civisync.org", contact_phone="+919840123458", head_name="Mr. Vijay Shankar"))
    db.add(Department(id=4, name="Solid Waste Management Dept", contact_email="waste@civisync.org", contact_phone="+919840123459", head_name="Mrs. Lakshmi Devi"))

    db.commit()
    db.close()
    print("✅ Seed data inserted")

if __name__ == "__main__":
    seed_db()
