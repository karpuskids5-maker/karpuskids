
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.getElementById('main-content');
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  const menuBtn = document.getElementById('menuBtn'); // Mobile menu button

  if (sidebar && mainContent && toggleSidebarBtn) {
    // Function to toggle sidebar for desktop
    const toggleSidebar = () => {
      sidebar.classList.toggle('collapsed');

      if (sidebar.classList.contains('collapsed')) {
        mainContent.style.marginLeft = '72px';
      } else {
        mainContent.style.marginLeft = '280px';
      }
    };

    toggleSidebarBtn.addEventListener('click', toggleSidebar);
  }

  if (sidebar && menuBtn) {
    // Function to toggle sidebar for mobile
    const toggleMobileMenu = () => {
      sidebar.classList.toggle('hidden');
    };

    menuBtn.addEventListener('click', toggleMobileMenu);
  }
});
