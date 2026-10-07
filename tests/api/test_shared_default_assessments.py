import unittest

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes.exams import list_published_assessment_catalog
from app.models.entities import (
    Base,
    Course,
    Exam,
    ExamStatus,
    ProviderAssessmentTemplateInstall,
    ProviderProfile,
    ProviderType,
    User,
    UserRole,
)
from app.services.default_assessments import list_default_assessments


class SharedDefaultAssessmentsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _employer(self, name: str, email: str) -> tuple[User, ProviderProfile]:
        user = User(
            email=email,
            full_name=f"{name} Owner",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        provider = ProviderProfile(
            user_id=user.id,
            provider_type=ProviderType.BUSINESS,
            display_name=name,
        )
        self.db.add(provider)
        self.db.flush()
        return user, provider

    def _custom_assessment(self, provider: ProviderProfile, title: str) -> None:
        course = Course(
            provider_id=provider.id,
            title=f"{title} course",
            description="",
            category="assessment",
        )
        self.db.add(course)
        self.db.flush()
        self.db.add(
            Exam(
                course_id=course.id,
                title=title,
                assessment_type="mcq",
                duration_minutes=20,
                status=ExamStatus.PUBLISHED,
            ),
        )
        self.db.commit()

    def _catalog(self, user: User) -> list[dict]:
        return list_published_assessment_catalog(
            q="",
            duration="all",
            sort="latest",
            db=self.db,
            current_user=user,
        )

    def test_every_employer_gets_defaults_while_custom_assessments_stay_private(self) -> None:
        first_user, first_provider = self._employer("First Company", "first@example.com")
        second_user, second_provider = self._employer("Second Company", "second@example.com")
        self._custom_assessment(first_provider, "First private assessment")
        self._custom_assessment(second_provider, "Second private assessment")

        first_catalog = self._catalog(first_user)
        second_catalog = self._catalog(second_user)
        default_titles = {item["title"] for item in list_default_assessments()}
        first_titles = {item["title"] for item in first_catalog}
        second_titles = {item["title"] for item in second_catalog}

        self.assertTrue(default_titles.issubset(first_titles))
        self.assertTrue(default_titles.issubset(second_titles))
        self.assertIn("First private assessment", first_titles)
        self.assertNotIn("Second private assessment", first_titles)
        self.assertIn("Second private assessment", second_titles)
        self.assertNotIn("First private assessment", second_titles)

        expected_defaults = len(default_titles)
        for provider in (first_provider, second_provider):
            install_count = int(
                self.db.scalar(
                    select(func.count(ProviderAssessmentTemplateInstall.id)).where(
                        ProviderAssessmentTemplateInstall.provider_id == provider.id,
                    ),
                )
                or 0
            )
            self.assertEqual(install_count, expected_defaults)

        # Reopening the catalog must not create duplicate platform assessments.
        self._catalog(first_user)
        first_install_count = int(
            self.db.scalar(
                select(func.count(ProviderAssessmentTemplateInstall.id)).where(
                    ProviderAssessmentTemplateInstall.provider_id == first_provider.id,
                ),
            )
            or 0
        )
        self.assertEqual(first_install_count, expected_defaults)


if __name__ == "__main__":
    unittest.main()
