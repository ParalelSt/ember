package app.ember.music

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateTestBuildTest {
    @Test fun `the test app is told apart by its package name`() {
        assertTrue(UpdateRules.isTestBuild("app.ember.music.test"))
        assertFalse(UpdateRules.isTestBuild("app.ember.music"))
        assertFalse(UpdateRules.isTestBuild(null))
        assertFalse(UpdateRules.isTestBuild("app.ember.music.testing"))
    }

    @Test fun `the test build skips the periodic and start checks`() {
        assertFalse(UpdateRules.backgroundCheckAllowed("app.ember.music.test", manual = false))
    }

    @Test fun `the test build still checks when the person asks or at the launch gate`() {
        assertTrue(UpdateRules.backgroundCheckAllowed("app.ember.music.test", manual = true))
    }

    @Test fun `the real app is unchanged`() {
        assertTrue(UpdateRules.backgroundCheckAllowed("app.ember.music", manual = false))
        assertTrue(UpdateRules.backgroundCheckAllowed("app.ember.music", manual = true))
    }

    @Test fun `a refused version is not fetched again in the background`() {
        assertTrue(UpdateRules.skipRejected("0.7.12", "0.7.12", manual = false))
    }

    @Test fun `a newer version, or a tap, is tried`() {
        assertFalse(UpdateRules.skipRejected("0.7.12", "0.7.13", manual = false))
        assertFalse(UpdateRules.skipRejected("0.7.12", "0.7.12", manual = true))
        assertFalse(UpdateRules.skipRejected(null, "0.7.12", manual = false))
    }

    @Test fun `a wrong package is a permanent refusal`() {
        assertTrue(UpdateRules.isPermanent(UpdateRules.Verdict.WRONG_PACKAGE))
        assertEquals(UpdateRules.Verdict.WRONG_PACKAGE, UpdateRules.verify(
            UpdateRules.Archive("app.ember.music", 5, setOf("a")), UpdateRules.Installed(1, setOf("a")), packageName = "app.ember.music.test"))
    }
}
