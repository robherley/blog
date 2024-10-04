const observer = new IntersectionObserver((entries, observer) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      startCounter(entry.target);
      observer.unobserve(entry.target);
    }
  });
}, {
  threshold: 0.5
});

const startCounter = (element) => {
  const target = +element.getAttribute('data-count');
  let count = 0;
  let speed = target / 300;

  const countElement = element.querySelector('.counter-count');

  const update = () => {
    const jitter = Math.floor(Math.random() * 2);
    count += speed + jitter;
    countElement.textContent = Math.ceil(count);

    if (count < target) {
      requestAnimationFrame(update);
    } else {
      countElement.textContent = target;
    }
  }

  update();
}

window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('.counter').forEach(counter => {
    observer.observe(counter);
  });
});
